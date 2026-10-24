"use client";

import { upload } from "@vercel/blob/client";
import { useRef, useState } from "react";
import type { Feedback } from "@/lib/analyze";

type Mode = "audio" | "text";

const EXTENSIONS: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/flac": "flac",
  "audio/amr": "amr",
};

// Определяет формат по первым байтам файла — у записей с диктофона часто нет расширения в имени.
async function detectAudioType(file: File): Promise<string | null> {
  if (file.type.startsWith("audio/") || file.type.startsWith("video/")) return file.type;
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (ascii(4, 8) === "ftyp") return "audio/mp4";
  if (ascii(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  if (ascii(0, 4) === "OggS") return "audio/ogg";
  if (ascii(0, 4) === "fLaC") return "audio/flac";
  if (ascii(0, 5) === "#!AMR") return "audio/amr";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "audio/webm";
  return null;
}

function uploadName(file: File, type: string): string {
  const safe = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "_") || "call";
  if (/\.(m4a|mp3|wav|ogg|oga|opus|webm|flac|amr|aac|mp4|mov|mkv)$/i.test(safe)) return safe;
  return `${safe}.${EXTENSIONS[type] ?? type.split("/")[1]}`;
}

function parseTimecode(tc: string): number | null {
  const parts = tc.trim().split(":").map(Number);
  if (parts.length < 2 || parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("audio");
  const [file, setFile] = useState<File | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [context, setContext] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [transcript, setTranscript] = useState("");
  const [copied, setCopied] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const busy = status !== null;

  async function onFileChange(f: File | null) {
    setFile(f);
    if (audioSrc) URL.revokeObjectURL(audioSrc);
    if (!f) return setAudioSrc(null);
    // Без указанного типа браузер может не воспроизвести файл без расширения.
    const type = (await detectAudioType(f)) ?? f.type;
    setAudioSrc(URL.createObjectURL(type ? new Blob([f], { type }) : f));
  }

  async function run() {
    setError(null);
    setFeedback(null);
    setTranscript("");
    try {
      let audioUrl: string | undefined;
      if (mode === "audio") {
        if (!file) throw new Error("Выберите файл записи");
        const contentType = await detectAudioType(file);
        if (!contentType) throw new Error("Не удалось распознать формат файла. Нужна аудио- или видеозапись.");
        setStatus("Загружаю запись…");
        const blob = await upload(`calls/${uploadName(file, contentType)}`, file, {
          access: "public",
          contentType,
          handleUploadUrl: "/api/upload",
          multipart: file.size > 50 * 1024 * 1024,
        });
        audioUrl = blob.url;
        setStatus("Расшифровываю звонок и готовлю фидбек… обычно это 1–2 минуты");
      } else {
        if (!pasted.trim()) throw new Error("Вставьте транскрипт");
        setStatus("Готовлю фидбек… обычно это около минуты");
      }

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "audio" ? { audioUrl, context } : { transcript: pasted, context },
        ),
      });
      const data = await res.json().catch(() => ({ error: `Ошибка сервера ${res.status}` }));
      if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`);
      setFeedback(data.feedback);
      setTranscript(data.transcript);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus(null);
    }
  }

  function seek(tc: string) {
    const seconds = parseTimecode(tc);
    const audio = audioRef.current;
    if (seconds === null || !audio) return;
    audio.currentTime = seconds;
    void audio.play();
  }

  function Timecode({ value }: { value: string }) {
    const canSeek = mode === "audio" && !!audioSrc && parseTimecode(value) !== null;
    return (
      <button className="tc" onClick={() => seek(value)} disabled={!canSeek} title={canSeek ? "Перейти к моменту" : undefined}>
        {value}
      </button>
    );
  }

  async function copyFollowUp() {
    if (!feedback) return;
    await navigator.clipboard.writeText(feedback.follow_up);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main>
      <h1>Разбор звонка с лидом</h1>
      <p className="lead">
        Загрузите запись созвона — получите резюме, потребности и возражения, три замечания с таймкодами,
        следующий шаг и готовый фоллоу-ап.
      </p>

      <section className="card">
        <div className="tabs">
          <button className={`tab ${mode === "audio" ? "active" : ""}`} onClick={() => setMode("audio")}>
            Запись звонка
          </button>
          <button className={`tab ${mode === "text" ? "active" : ""}`} onClick={() => setMode("text")}>
            Готовый транскрипт
          </button>
        </div>

        {mode === "audio" ? (
          <>
            <label>
              Аудио или видео <span className="hint">mp3, m4a, wav, ogg, mp4, webm, записи диктофона — до 500 МБ</span>
            </label>
            <input type="file" onChange={(e) => onFileChange(e.target.files?.[0] ?? null)} />
          </>
        ) : (
          <>
            <label>
              Транскрипт <span className="hint">лучше с таймкодами, например «[03:15] Менеджер: …»</span>
            </label>
            <textarea rows={10} value={pasted} onChange={(e) => setPasted(e.target.value)} />
          </>
        )}

        <label>
          Контекст <span className="hint">необязательно: что продаём, цель звонка, имя менеджера</span>
        </label>
        <textarea rows={3} value={context} onChange={(e) => setContext(e.target.value)} />

        <button className="primary" onClick={run} disabled={busy}>
          {busy ? "Обрабатываю…" : "Получить фидбек"}
        </button>
        {status && <p className="status">{status}</p>}
        {error && <p className="error">{error}</p>}
      </section>

      {feedback && (
        <>
          {mode === "audio" && audioSrc && <audio ref={audioRef} src={audioSrc} controls />}

          <section className="card">
            <h2>Резюме звонка</h2>
            <p style={{ margin: 0 }}>{feedback.summary}</p>
          </section>

          <section className="card">
            <h2>Потребности</h2>
            <ul>
              {feedback.needs.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>Возражения</h2>
            {feedback.objections.length === 0 ? (
              <p style={{ margin: 0 }}>Явных возражений не прозвучало.</p>
            ) : (
              <ul>
                {feedback.objections.map((o, i) => (
                  <li key={i}>
                    <Timecode value={o.timecode} />
                    <strong>{o.objection}</strong>
                    <div className="hint">{o.handling}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <h2>Три замечания</h2>
            {feedback.remarks.map((r, i) => (
              <div className="remark" key={i}>
                <div>
                  <Timecode value={r.timecode} />
                  <strong>{r.issue}</strong>
                </div>
                {r.quote && <p className="quote">«{r.quote}»</p>}
                <div className="better">
                  <strong>Лучше:</strong> {r.better}
                </div>
              </div>
            ))}
          </section>

          <section className="card">
            <h2>Следующий шаг</h2>
            <p style={{ margin: 0 }}>{feedback.next_step}</p>
          </section>

          <section className="card">
            <div className="row">
              <h2>Фоллоу-ап</h2>
              <button className="secondary" onClick={copyFollowUp}>
                {copied ? "Скопировано" : "Копировать"}
              </button>
            </div>
            <pre className="followup">{feedback.follow_up}</pre>
          </section>

          {transcript && (
            <section className="card">
              <details>
                <summary>Транскрипт</summary>
                <pre>{transcript}</pre>
              </details>
            </section>
          )}
        </>
      )}
    </main>
  );
}
