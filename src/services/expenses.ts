import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { CATEGORY_EMOJI, isCategory } from "../categories.js";
import { db } from "../db/client.js";
import { transactions, users, type Transaction, type User } from "../db/schema.js";
import { formatMoney } from "../lib/money.js";
import { localDate, periodRange, type Period } from "../lib/time.js";

export async function getOwner(phone: string): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.phone, phone) });
}

export async function ensureOwner(phone: string, timezone: string, currency: string): Promise<User> {
  await db.insert(users).values({ phone, timezone, currency }).onConflictDoUpdate({
    target: users.phone,
    set: { timezone, currency },
  });
  return (await getOwner(phone))!;
}

export async function touchInbound(user: User, at: Date): Promise<User> {
  const [updated] = await db.update(users).set({ lastInboundAt: at }).where(eq(users.id, user.id)).returning();
  return updated!;
}

export function emoji(category: string): string {
  return isCategory(category) ? CATEGORY_EMOJI[category] : "📦";
}

/** "$12.50 · ☕ Café · flat white" */
export function describeTx(tx: Transaction, baseCurrency: string): string {
  const parts = [formatMoney(tx.amountMinor, tx.currency, baseCurrency), `${emoji(tx.category)} ${tx.category}`];
  const detail = tx.description ?? tx.merchant;
  // Evita "🛒 Supermercado · supermercado".
  if (detail && detail.trim().toLowerCase() !== tx.category.toLowerCase()) parts.push(detail);
  return parts.join(" · ");
}

export async function pendingTransactions(userId: number, limit = 10) {
  return db.query.transactions.findMany({
    where: and(eq(transactions.userId, userId), eq(transactions.status, "pending")),
    orderBy: desc(transactions.occurredAt),
    limit,
  });
}

/** Pendientes que todavía no le hemos preguntado al usuario (quedaron en cola). */
export async function unaskedPending(userId: number) {
  return db.query.transactions.findMany({
    where: and(eq(transactions.userId, userId), eq(transactions.status, "pending"), isNull(transactions.askedAt)),
    orderBy: asc(transactions.occurredAt),
  });
}

export async function recentTransactions(userId: number, limit = 5) {
  return db.query.transactions.findMany({
    where: and(eq(transactions.userId, userId), eq(transactions.status, "confirmed")),
    orderBy: desc(transactions.createdAt),
    limit,
  });
}

export async function getTransaction(userId: number, id: number) {
  return db.query.transactions.findFirst({ where: and(eq(transactions.userId, userId), eq(transactions.id, id)) });
}

export async function markAsked(ids: number[], at = new Date()) {
  for (const id of ids) await db.update(transactions).set({ askedAt: at }).where(eq(transactions.id, id));
}

export interface PeriodSummary {
  totals: { currency: string; amountMinor: number; count: number }[];
  byCategory: { category: string; currency: string; amountMinor: number }[];
}

export async function summarize(
  user: User,
  period: Period,
  opts: { category?: string | null; now?: Date } = {},
): Promise<PeriodSummary> {
  const { from, to } = periodRange(period, opts.now ?? new Date(), user.timezone);
  const filters = [eq(transactions.userId, user.id), gte(transactions.occurredAt, from), lt(transactions.occurredAt, to)];
  if (opts.category) filters.push(eq(transactions.category, opts.category));

  const rows = await db
    .select({
      category: transactions.category,
      currency: transactions.currency,
      amountMinor: sql<number>`sum(${transactions.amountMinor})::bigint`.mapWith(Number),
      count: sql<number>`count(*)::int`.mapWith(Number),
    })
    .from(transactions)
    .where(and(...filters))
    .groupBy(transactions.category, transactions.currency);

  const totals = new Map<string, { currency: string; amountMinor: number; count: number }>();
  for (const r of rows) {
    const t = totals.get(r.currency) ?? { currency: r.currency, amountMinor: 0, count: 0 };
    t.amountMinor += r.amountMinor;
    t.count += r.count;
    totals.set(r.currency, t);
  }
  return {
    // La moneda base primero; luego el resto.
    totals: [...totals.values()].sort((a, b) => Number(b.currency === user.currency) - Number(a.currency === user.currency)),
    byCategory: rows
      .map(({ category, currency, amountMinor }) => ({ category, currency, amountMinor }))
      .sort((a, b) => b.amountMinor - a.amountMinor),
  };
}

const PERIOD_LABEL: Record<Period, string> = { today: "Hoy", week: "Esta semana", month: "Este mes" };

export function formatSummary(user: User, period: Period, summary: PeriodSummary, category?: string | null): string {
  const label = PERIOD_LABEL[period] + (category ? ` en ${emoji(category)} ${category}` : "");
  if (summary.totals.length === 0) return `${label}: sin gastos registrados.`;

  const totalLine = summary.totals
    .map((t) => `${formatMoney(t.amountMinor, t.currency, user.currency)} (${t.count} ${t.count === 1 ? "gasto" : "gastos"})`)
    .join(" + ");
  const lines = [`*${label}:* ${totalLine}`];
  if (!category) {
    for (const c of summary.byCategory.slice(0, 8)) {
      lines.push(`${emoji(c.category)} ${c.category}: ${formatMoney(c.amountMinor, c.currency, user.currency)}`);
    }
  }
  return lines.join("\n");
}

export function txWhen(tx: Transaction, user: User): string {
  return localDate(tx.occurredAt, user.timezone);
}
