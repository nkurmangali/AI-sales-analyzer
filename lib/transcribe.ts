// Транскрипция записи звонка через Deepgram (pre-recorded API) с разметкой спикеров и таймкодами.

type DeepgramUtterance = {
  start: number;
  end: number;
  speaker?: number;
  transcript: string;
};

type DeepgramResponse = {
  results?: {
    utterances?: DeepgramUtterance[];
    channels?: { alternatives?: { transcript?: string }[] }[];
  };
};

export function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export async function transcribeFromUrl(audioUrl: string): Promise<string> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY не задан");

  const params = new URLSearchParams({
    model: process.env.DEEPGRAM_MODEL || "nova-2",
    language: process.env.DEEPGRAM_LANGUAGE || "ru",
    diarize: "true",
    utterances: "true",
    punctuate: "true",
    smart_format: "true",
  });

  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: audioUrl }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Deepgram ${res.status}: ${detail.slice(0, 500)}`);
  }

  const data = (await res.json()) as DeepgramResponse;
  const utterances = data.results?.utterances ?? [];

  if (utterances.length > 0) {
    return utterances
      .map((u) => {
        const speaker = u.speaker !== undefined ? `Спикер ${u.speaker + 1}` : "Спикер";
        return `[${formatTimecode(u.start)}] ${speaker}: ${u.transcript.trim()}`;
      })
      .join("\n");
  }

  const plain = data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim();
  if (!plain) throw new Error("Не удалось распознать речь в записи");
  return plain;
}
