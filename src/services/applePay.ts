import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { transactions, type Transaction, type User } from "../db/schema.js";
import { parseAmount, toMinor } from "../lib/money.js";
import { extractPurchase, suggestCategory } from "../llm.js";
import { sendText } from "../whatsapp.js";
import { askAbout } from "./ask.js";
import { markApplePayConnected } from "./users.js";

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const ApplePayPayload = z
  .object({
    amount: z.preprocess(emptyToUndefined, z.union([z.string(), z.number()]).transform(String).optional()),
    merchant: z.preprocess(emptyToUndefined, z.string().trim().optional()),
    card: z.preprocess(emptyToUndefined, z.string().optional()),
    // Optional currency, in case the Shortcut sends it separately.
    currency: z.preprocess(emptyToUndefined, z.string().length(3).optional()),
    // The whole payment input as text; used when the properties are missing.
    raw: z.preprocess(emptyToUndefined, z.string().optional()),
  })
  .refine((p) => p.amount !== undefined || p.raw !== undefined, { message: "amount or raw is required" });

type Payload = z.infer<typeof ApplePayPayload>;

/** Amount, currency and merchant: from the fields if present, or extracted from `raw` with Claude. */
async function resolvePurchase(user: User, payload: Payload) {
  if (payload.amount !== undefined) {
    const parsed = parseAmount(payload.amount, payload.currency ?? user.currency);
    if (!parsed) return null;
    return { ...parsed, currency: payload.currency ?? parsed.currency, merchant: payload.merchant ?? "Desconocido", card: payload.card };
  }

  console.log(`[apple-pay] raw input from user ${user.id}: ${JSON.stringify(payload.raw!.slice(0, 500))}`);
  const extracted = await extractPurchase(payload.raw!, user.currency);
  if (!extracted?.amount || extracted.amount <= 0) return null;
  const currency = (extracted.currency ?? user.currency).toUpperCase();
  return {
    amountMinor: toMinor(extracted.amount, currency),
    currency,
    merchant: extracted.merchant ?? payload.merchant ?? "Desconocido",
    card: extracted.card ?? payload.card,
  };
}

const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

export type IngestResult =
  | { status: "created"; transaction: Transaction; asked: boolean }
  | { status: "duplicate"; transaction: Transaction }
  | { status: "invalid_amount" };

export async function ingestApplePay(user: User, payload: Payload): Promise<IngestResult> {
  const parsed = await resolvePurchase(user, payload);
  if (!parsed) return { status: "invalid_amount" };
  const { currency, merchant } = parsed;

  // A Shortcut can fire twice for the same purchase.
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);
  const duplicate = await db.query.transactions.findFirst({
    where: and(
      eq(transactions.userId, user.id),
      eq(transactions.source, "apple_pay"),
      eq(transactions.amountMinor, parsed.amountMinor),
      eq(transactions.merchant, merchant),
      gte(transactions.createdAt, since),
    ),
  });
  if (duplicate) return { status: "duplicate", transaction: duplicate };

  const category = await suggestCategory(merchant, user.timezone);
  const [tx] = await db
    .insert(transactions)
    .values({
      userId: user.id,
      amountMinor: parsed.amountMinor,
      currency,
      merchant,
      category,
      source: "apple_pay",
      status: "pending",
      occurredAt: new Date(),
      raw: payload,
    })
    .returning();

  // First purchase: confirm the Shortcut is set up correctly.
  if (await markApplePayConnected(user.id)) {
    await sendText(user, "🎉 ¡Tu Apple Pay quedó conectado! Desde ahora te voy a preguntar por cada compra.");
  }

  // If the 24h window is closed, the question stays queued (askedAt = null).
  const asked = await askAbout(user, tx!);
  return { status: "created", transaction: tx!, asked };
}
