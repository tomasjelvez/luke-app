import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { transactions, type Transaction, type User } from "../db/schema.js";
import { parseAmount } from "../lib/money.js";
import { suggestCategory } from "../llm.js";
import { sendText } from "../whatsapp.js";
import { askAbout } from "./ask.js";
import { markApplePayConnected } from "./users.js";

export const ApplePayPayload = z.object({
  amount: z.union([z.string(), z.number()]).transform(String),
  merchant: z.string().trim().min(1).default("Desconocido"),
  card: z.string().optional(),
  // Moneda opcional por si el Atajo la manda aparte.
  currency: z.string().length(3).optional(),
});

const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

export type IngestResult =
  | { status: "created"; transaction: Transaction; asked: boolean }
  | { status: "duplicate"; transaction: Transaction }
  | { status: "invalid_amount" };

export async function ingestApplePay(user: User, payload: z.infer<typeof ApplePayPayload>): Promise<IngestResult> {
  const parsed = parseAmount(payload.amount, payload.currency ?? user.currency);
  if (!parsed) return { status: "invalid_amount" };
  const currency = payload.currency ?? parsed.currency;

  // Un Atajo puede dispararse dos veces por la misma compra.
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);
  const duplicate = await db.query.transactions.findFirst({
    where: and(
      eq(transactions.userId, user.id),
      eq(transactions.source, "apple_pay"),
      eq(transactions.amountMinor, parsed.amountMinor),
      eq(transactions.merchant, payload.merchant),
      gte(transactions.createdAt, since),
    ),
  });
  if (duplicate) return { status: "duplicate", transaction: duplicate };

  const category = await suggestCategory(payload.merchant, user.timezone);
  const [tx] = await db
    .insert(transactions)
    .values({
      userId: user.id,
      amountMinor: parsed.amountMinor,
      currency,
      merchant: payload.merchant,
      category,
      source: "apple_pay",
      status: "pending",
      occurredAt: new Date(),
      raw: payload,
    })
    .returning();

  // Primera compra: confirmamos que el Atajo quedó bien configurado.
  if (await markApplePayConnected(user.id)) {
    await sendText(user, "🎉 ¡Tu Apple Pay quedó conectado! Desde ahora te voy a preguntar por cada compra.");
  }

  // Si la ventana de 24 h está cerrada, la pregunta queda en cola (askedAt = null).
  const asked = await askAbout(user, tx!);
  return { status: "created", transaction: tx!, asked };
}
