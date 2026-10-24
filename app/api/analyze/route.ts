import Anthropic from "@anthropic-ai/sdk";
import { del } from "@vercel/blob";
import { NextResponse } from "next/server";
import { analyzeCall } from "@/lib/analyze";
import { transcribeFromUrl } from "@/lib/transcribe";

export const maxDuration = 300;

type AnalyzeRequest = {
  audioUrl?: string;
  transcript?: string;
  context?: string;
};

export async function POST(request: Request) {
  const { audioUrl, transcript: pasted, context } = (await request.json()) as AnalyzeRequest;

  if (!audioUrl && !pasted?.trim()) {
    return NextResponse.json({ error: "Загрузите запись или вставьте транскрипт" }, { status: 400 });
  }

  try {
    let transcript = pasted?.trim() ?? "";
    if (audioUrl) {
      try {
        transcript = await transcribeFromUrl(audioUrl);
      } finally {
        // Запись больше не нужна — не храним её в Blob.
        await del(audioUrl).catch(() => {});
      }
    }

    const feedback = await analyzeCall(transcript, context);
    return NextResponse.json({ transcript, feedback });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "Превышен лимит запросов к Claude, попробуйте позже" }, { status: 429 });
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "Неверный ANTHROPIC_API_KEY" }, { status: 500 });
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Claude API ${error.status}: ${error.message}` }, { status: 502 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Неизвестная ошибка" },
      { status: 500 },
    );
  }
}
