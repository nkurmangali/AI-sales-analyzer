import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const FeedbackSchema = z.object({
  summary: z.string().describe("Резюме звонка: 3–6 предложений о том, что произошло и чем закончилось"),
  needs: z.array(z.string()).describe("Выявленные потребности, цели и боли лида"),
  objections: z
    .array(
      z.object({
        objection: z.string().describe("Суть возражения или сомнения лида"),
        timecode: z.string().describe("Таймкод из транскрипта, например 07:42"),
        handling: z.string().describe("Как менеджер отработал возражение и насколько удачно"),
      }),
    )
    .describe("Возражения лида; пустой массив, если их не было"),
  remarks: z
    .array(
      z.object({
        timecode: z.string().describe("Таймкод момента из транскрипта, например 12:05"),
        quote: z.string().describe("Короткая цитата менеджера в этот момент"),
        issue: z.string().describe("Что было не так и почему это важно"),
        better: z.string().describe("Как сказать или сделать лучше — конкретная формулировка"),
      }),
    )
    .describe("Ровно три конкретных замечания менеджеру"),
  next_step: z.string().describe("Конкретный следующий шаг с лидом: что, кто и когда"),
  follow_up: z.string().describe("Готовое фоллоу-ап сообщение лиду от имени менеджера"),
});

export type Feedback = z.infer<typeof FeedbackSchema>;

const SYSTEM_PROMPT = `Ты — опытный руководитель отдела продаж и коуч менеджеров. Тебе дают транскрипт созвона менеджера с лидом. Строки транскрипта начинаются с таймкода [ММ:СС] и метки спикера; определи по смыслу, кто из спикеров менеджер, а кто лид.

Разбери звонок и дай фидбек на русском языке:
- summary — резюме звонка: о чём говорили, к чему пришли, на какой стадии лид.
- needs — потребности, цели и боли лида, которые прозвучали явно или читаются между строк.
- objections — возражения и сомнения лида, с таймкодом и оценкой того, как менеджер их отработал.
- remarks — ровно три самых важных конкретных замечания менеджеру. Каждое привязано к реальному таймкоду из транскрипта, содержит цитату, объяснение проблемы и готовую лучшую формулировку. Выбирай моменты, которые сильнее всего влияют на сделку, а не мелочи.
- next_step — один конкретный следующий шаг с лидом.
- follow_up — готовое к отправке сообщение лиду (мессенджер или email) от имени менеджера: тёплое, короткое, с отсылкой к сказанному в звонке и с понятным призывом к следующему шагу. Без плейсхолдеров там, где данные есть в звонке.

Используй только таймкоды, которые есть в транскрипте. Если в транскрипте нет таймкодов, укажи в поле timecode «—». Не выдумывай факты, которых не было в разговоре.`;

const client = new Anthropic();

export async function analyzeCall(transcript: string, context?: string): Promise<Feedback> {
  const userContent = [
    context?.trim() ? `Контекст (что продаём, кто менеджер, цель звонка):\n${context.trim()}` : null,
    `Транскрипт звонка:\n<transcript>\n${transcript}\n</transcript>`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: betaZodOutputFormat(FeedbackSchema),
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Модель отказалась анализировать этот звонок");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Ответ модели оборвался — звонок слишком длинный");
  }
  if (!response.parsed_output) {
    throw new Error("Не удалось разобрать ответ модели");
  }

  const feedback = response.parsed_output;
  return { ...feedback, remarks: feedback.remarks.slice(0, 3) };
}
