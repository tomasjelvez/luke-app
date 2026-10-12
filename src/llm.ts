import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { CATEGORIES, type Category } from "./categories.js";
import { config } from "./config.js";

const client = new Anthropic();

// --- Interpret a user message -------------------------------------------------

const Action = z.object({
  kind: z
    .enum(["create", "annotate", "update", "delete", "query", "smalltalk"])
    .describe(
      "create: new expense. annotate: adds context/category to a pending expense. " +
        "update: corrects an existing expense. delete: deletes an expense. query: asks about totals. " +
        "smalltalk: a greeting, a question or anything that isn't an expense.",
    ),
  tx_id: z.number().int().nullable().describe("ID of the existing expense (annotate/update/delete); null otherwise."),
  amount: z.number().nullable().describe("Amount in the currency's normal units (12.5 = twelve fifty)."),
  currency: z.string().nullable().describe("ISO 4217 code (AUD, CLP, USD...). null = default currency."),
  category: z.enum(CATEGORIES).nullable(),
  description: z
    .string()
    .nullable()
    .describe("Short description in Spanish, e.g. 'pan y bebida'. null if it would just repeat the category."),
  date: z.string().nullable().describe("Date YYYY-MM-DD if the user mentioned another day (e.g. 'ayer'); otherwise null."),
  period: z.enum(["today", "week", "month"]).nullable().describe("Only for query."),
});

const Interpretation = z.object({
  actions: z.array(Action),
  reply: z
    .string()
    .nullable()
    .describe("Short, warm reply in Spanish, only for smalltalk or when you need to ask for clarification; null otherwise."),
});

export type InterpretedAction = z.infer<typeof Action>;
export type Interpretation = z.infer<typeof Interpretation>;

const SYSTEM_PROMPT = `You are Luke, an assistant that records personal expenses over WhatsApp. The user writes in informal Spanish (often Chilean), by text or by transcribed audio (the transcript may contain errors). <context> holds their name, time zone and default currency.

Your task: turn each message into structured actions.

Rules:
- A message can contain several expenses ("8 lucas en almuerzo y 2 en café" = two create actions).
- Chilean slang: "luca(s)" = 1,000 CLP, "gamba" = 100 CLP, "quina" = 500 CLP. If they use these terms, the currency is CLP.
- If no currency is mentioned, leave currency null (the default currency is used).
- If the user replies to a purchase notice or talks about something that matches a pending expense, use annotate with that pending tx_id, not create. If they quote a message (quoted_tx_id), that is the expense they mean.
- Corrections ("no, eran 3000", "bórralo", "eso fue transporte") apply to the quoted expense or, if nothing is quoted, to the most recent one.
- Always pick the most reasonable category from the list; use "Otros" only if nothing fits.
- Questions like "¿cuánto llevo esta semana?" or "¿cuánto gasté en comida este mes?" are query (set category if they filter by one).
- Never make up a tx_id: only use the ones in the context.
- If the message is ambiguous (e.g. it has no amount), don't guess: use smalltalk with a short question in reply.
- Always write reply and description in Spanish.`;

export interface InterpretContext {
  userName: string | null;
  timezone: string;
  today: string;
  defaultCurrency: string;
  pending: { tx_id: number; amount: string; merchant: string | null; suggested_category: string; when: string }[];
  recent: { tx_id: number; amount: string; category: string; description: string | null; when: string }[];
  quotedTxId: number | null;
}

export async function interpretMessage(text: string, ctx: InterpretContext): Promise<Interpretation | null> {
  const response = await client.messages.parse({
    model: config.LLM_MODEL,
    max_tokens: 16000,
    output_config: { effort: "low", format: zodOutputFormat(Interpretation) },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content:
          `<context>\n${JSON.stringify(
            {
              user: ctx.userName,
              time_zone: ctx.timezone,
              today: ctx.today,
              default_currency: ctx.defaultCurrency,
              pending_expenses_without_context: ctx.pending,
              recent_expenses: ctx.recent,
              quoted_tx_id: ctx.quotedTxId,
            },
            null,
            2,
          )}\n</context>\n\n` + `<message>\n${text}\n</message>`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    console.warn("[llm] refusal", response.stop_details);
    return null;
  }
  return response.parsed_output ?? null;
}

// --- Suggest a category for a merchant (Apple Pay) -----------------------------

const CategoryGuess = z.object({ category: z.enum(CATEGORIES) });

export async function suggestCategory(merchant: string, timezone: string): Promise<Category> {
  try {
    const response = await client.messages.parse({
      model: config.LLM_MODEL,
      max_tokens: 16000,
      output_config: { effort: "low", format: zodOutputFormat(CategoryGuess) },
      system:
        "Classify the merchant of a card purchase into a personal expense category. " +
        `The user lives in the ${timezone} time zone. ` +
        "Names appear as they do in Apple Pay or on a bank statement, e.g. 'Woolworths' or 'AMPOL TWEED HEADS'.",
      messages: [{ role: "user", content: merchant }],
    });
    return response.parsed_output?.category ?? "Otros";
  } catch (err) {
    console.error("[llm] suggestCategory failed", err);
    return "Otros";
  }
}

// --- Extract the purchase from the Shortcut's raw input ------------------------

const ExtractedPurchase = z.object({
  amount: z.number().nullable().describe("Amount in normal units (45.05 = forty-five oh five)."),
  currency: z.string().nullable().describe("ISO 4217 code if it can be inferred; otherwise null."),
  merchant: z.string().nullable().describe("Merchant name as it appears, without city or codes if possible."),
  card: z.string().nullable().describe("Card or pass name, if present."),
});

export type ExtractedPurchase = z.infer<typeof ExtractedPurchase>;

/**
 * Fallback for when the Shortcut sends the payment only as text (`raw`): extracts
 * the amount, currency and merchant from it.
 */
export async function extractPurchase(raw: string, defaultCurrency: string): Promise<ExtractedPurchase | null> {
  const response = await client.messages.parse({
    model: config.LLM_MODEL,
    max_tokens: 16000,
    output_config: { effort: "low", format: zodOutputFormat(ExtractedPurchase) },
    system:
      "You receive the text the iOS Shortcuts app produces when paying with Apple Pay (a Wallet transaction converted to text). " +
      `Extract the amount, currency, merchant and card. If the currency isn't explicit, use null (${defaultCurrency} will be assumed). ` +
      "Don't make anything up: if something is missing, return null.",
    messages: [{ role: "user", content: raw.slice(0, 4000) }],
  });
  if (response.stop_reason === "refusal") return null;
  return response.parsed_output ?? null;
}
