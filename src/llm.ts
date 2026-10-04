import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { CATEGORIES, type Category } from "./categories.js";
import { config } from "./config.js";

const client = new Anthropic();

// --- Interpretar un mensaje del usuario -------------------------------------

const Action = z.object({
  kind: z
    .enum(["create", "annotate", "update", "delete", "query", "smalltalk"])
    .describe(
      "create: gasto nuevo. annotate: agrega contexto/categoría a un gasto pendiente. " +
        "update: corrige un gasto existente. delete: borra un gasto. query: pregunta por totales. " +
        "smalltalk: saludo, duda o algo que no es un gasto.",
    ),
  tx_id: z.number().int().nullable().describe("ID del gasto existente (annotate/update/delete); null en otro caso."),
  amount: z.number().nullable().describe("Monto en unidades normales de la moneda (12.5 = doce con cincuenta)."),
  currency: z.string().nullable().describe("Código ISO 4217 (AUD, CLP, USD...). null = moneda por defecto."),
  category: z.enum(CATEGORIES).nullable(),
  description: z
    .string()
    .nullable()
    .describe("Descripción breve en español, ej. 'pan y bebida'. null si solo repetiría la categoría."),
  date: z.string().nullable().describe("Fecha YYYY-MM-DD si el usuario indicó otro día (ej. 'ayer'); si no, null."),
  period: z.enum(["today", "week", "month"]).nullable().describe("Solo para query."),
});

const Interpretation = z.object({
  actions: z.array(Action),
  reply: z
    .string()
    .nullable()
    .describe("Respuesta breve y cálida solo para smalltalk o si necesitas pedir una aclaración; null en otro caso."),
});

export type InterpretedAction = z.infer<typeof Action>;
export type Interpretation = z.infer<typeof Interpretation>;

const SYSTEM_PROMPT = `Eres Luke, un asistente que registra gastos personales por WhatsApp. El usuario es chileno y vive en Australia; te escribe en español chileno informal, por texto o por audio transcrito (la transcripción puede tener errores).

Tu tarea: convertir cada mensaje en acciones estructuradas.

Reglas:
- Un mensaje puede traer varios gastos ("8 lucas en almuerzo y 2 en café" = dos acciones create).
- Modismos chilenos: "luca(s)" = 1.000 CLP, "gamba" = 100 CLP, "quina" = 500 CLP. Si usa estos términos, la moneda es CLP.
- Si no se menciona moneda, deja currency en null (se usa la moneda por defecto).
- Si el usuario responde a un aviso de compra o habla de algo que calza con un gasto pendiente, usa annotate con el tx_id de ese pendiente, no create. Si cita un mensaje (quoted_tx_id), ese es el gasto al que se refiere.
- Correcciones ("no, eran 3000", "bórralo", "eso fue transporte") aplican al gasto citado o, si no hay cita, al más reciente.
- Elige siempre la categoría más razonable de la lista; usa "Otros" solo si nada calza.
- Preguntas como "¿cuánto llevo esta semana?" o "¿cuánto gasté en comida este mes?" son query (usa category si filtra).
- Nunca inventes tx_id: usa solo los que aparecen en el contexto.
- Si el mensaje es ambiguo (por ejemplo, no tiene monto), no adivines: usa smalltalk con una pregunta corta en reply.`;

export interface InterpretContext {
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
          `<contexto>\n${JSON.stringify(
            {
              hoy: ctx.today,
              moneda_por_defecto: ctx.defaultCurrency,
              gastos_pendientes_de_contexto: ctx.pending,
              gastos_recientes: ctx.recent,
              quoted_tx_id: ctx.quotedTxId,
            },
            null,
            2,
          )}\n</contexto>\n\n` + `<mensaje>\n${text}\n</mensaje>`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    console.warn("[llm] refusal", response.stop_details);
    return null;
  }
  return response.parsed_output ?? null;
}

// --- Sugerir categoría para un comercio (Apple Pay) -------------------------

const CategoryGuess = z.object({ category: z.enum(CATEGORIES) });

export async function suggestCategory(merchant: string): Promise<Category> {
  try {
    const response = await client.messages.parse({
      model: config.LLM_MODEL,
      max_tokens: 16000,
      output_config: { effort: "low", format: zodOutputFormat(CategoryGuess) },
      system:
        "Clasifica el comercio de una compra con tarjeta en Australia (o Chile) en una categoría de gasto personal. " +
        "Los nombres vienen como aparecen en el estado de cuenta, ej. 'WOOLWORTHS 1234 SYDNEY'.",
      messages: [{ role: "user", content: merchant }],
    });
    return response.parsed_output?.category ?? "Otros";
  } catch (err) {
    console.error("[llm] suggestCategory falló", err);
    return "Otros";
  }
}
