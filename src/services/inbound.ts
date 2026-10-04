import { eq } from "drizzle-orm";
import { isCategory } from "../categories.js";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { messages, transactions, type Transaction, type User } from "../db/schema.js";
import { formatMoney, toMinor } from "../lib/money.js";
import type { InboundEvent } from "../lib/kapsoPayload.js";
import { localDate, startOfLocalDay } from "../lib/time.js";
import { interpretMessage, type InterpretedAction } from "../llm.js";
import { markReadWithTyping, sendText } from "../whatsapp.js";
import { flushQueuedQuestions } from "./ask.js";
import {
  describeTx,
  ensureOwner,
  formatSummary,
  getTransaction,
  pendingTransactions,
  recentTransactions,
  summarize,
  touchInbound,
  txWhen,
} from "./expenses.js";

export async function handleInbound(event: InboundEvent): Promise<void> {
  const { message } = event;
  const from = (message.from ?? event.conversation?.phone_number ?? "").replace(/\D/g, "");
  if (from !== config.OWNER_PHONE) {
    console.warn(`[inbound] mensaje de un número no autorizado (${from || "sin número"}), ignorado`);
    return;
  }

  let user = await ensureOwner(config.OWNER_PHONE, config.OWNER_TIMEZONE, config.OWNER_CURRENCY);

  const text = message.text?.body ?? message.kapso?.transcript?.text ?? null;
  const [logged] = await db
    .insert(messages)
    .values({ wamid: message.id, userId: user.id, direction: "inbound", type: message.type, body: text })
    .onConflictDoNothing()
    .returning();
  if (!logged) return; // Webhook repetido: ya lo procesamos.

  user = await touchInbound(user, new Date());
  await markReadWithTyping(message.id);

  const quotedTxId = await quotedTransaction(message.context?.id);

  try {
    const button = message.interactive?.button_reply;
    if (button) {
      await handleButton(user, button.id);
    } else if (text) {
      await handleText(user, text, quotedTxId, message.id);
    } else if (message.type === "audio") {
      await sendText(user, "No pude transcribir el audio 😕 ¿Me lo escribes?", { replyTo: message.id });
    } else {
      await sendText(user, "Por ahora entiendo texto y audios. Las fotos de boletas vienen pronto 📸", {
        replyTo: message.id,
      });
    }
  } catch (err) {
    console.error("[inbound] error procesando mensaje", err);
    await sendText(user, "Tuve un problema procesando eso 🙈 ¿Lo intentas de nuevo?", { replyTo: message.id });
  }

  await flushQueuedQuestions(user);
}

async function quotedTransaction(wamid: string | undefined): Promise<number | null> {
  if (!wamid) return null;
  const row = await db.query.messages.findFirst({ where: eq(messages.wamid, wamid) });
  return row?.transactionId ?? null;
}

async function handleButton(user: User, buttonId: string) {
  const [action, rawId] = buttonId.split(":");
  const tx = await getTransaction(user.id, Number(rawId));
  if (!tx) {
    await sendText(user, "No encontré ese gasto, puede que lo hayas borrado.");
    return;
  }

  if (action === "ok") {
    const [updated] = await db
      .update(transactions)
      .set({ status: "confirmed" })
      .where(eq(transactions.id, tx.id))
      .returning();
    await sendText(user, `✅ ${describeTx(updated!, user.currency)}`, { transactionId: tx.id });
  } else if (action === "other") {
    await sendText(user, "Dale, cuéntame qué fue 🎙️ (texto o audio)", { transactionId: tx.id });
  }
}

async function handleText(user: User, text: string, quotedTxId: number | null, replyTo: string) {
  const [pending, recent] = await Promise.all([pendingTransactions(user.id), recentTransactions(user.id)]);
  const fmtAmount = (tx: Transaction) => `${formatMoney(tx.amountMinor, tx.currency)} ${tx.currency}`;

  const interpretation = await interpretMessage(text, {
    today: localDate(new Date(), user.timezone),
    defaultCurrency: user.currency,
    pending: pending.map((tx) => ({
      tx_id: tx.id,
      amount: fmtAmount(tx),
      merchant: tx.merchant,
      suggested_category: tx.category,
      when: txWhen(tx, user),
    })),
    recent: recent.map((tx) => ({
      tx_id: tx.id,
      amount: fmtAmount(tx),
      category: tx.category,
      description: tx.description ?? tx.merchant,
      when: txWhen(tx, user),
    })),
    quotedTxId,
  });

  if (!interpretation) {
    await sendText(user, "No logré entender eso 🤔 ¿Me lo dices de otra forma?", { replyTo });
    return;
  }

  const lines: string[] = [];
  const touched: number[] = [];
  for (const action of interpretation.actions) {
    const result = await applyAction(user, action);
    if (result) {
      lines.push(result.line);
      if (result.txId) touched.push(result.txId);
    }
  }
  if (interpretation.reply) lines.push(interpretation.reply);
  if (lines.length === 0) {
    lines.push('No entendí 🤔 Prueba con algo como "almuerzo 15 dólares" o mándame un audio.');
  }

  // Si la respuesta habla de un solo gasto, la vinculamos para poder corregirlo citándola.
  await sendText(user, lines.join("\n"), { replyTo, transactionId: touched.length === 1 ? touched[0] : undefined });
}

async function applyAction(user: User, a: InterpretedAction): Promise<{ line: string; txId?: number } | null> {
  const currency = (a.currency ?? user.currency).toUpperCase();
  const category = a.category && isCategory(a.category) ? a.category : null;

  switch (a.kind) {
    case "create": {
      if (a.amount === null || a.amount <= 0) return { line: "❓ No entendí el monto de uno de los gastos." };
      const [tx] = await db
        .insert(transactions)
        .values({
          userId: user.id,
          amountMinor: toMinor(a.amount, currency),
          currency,
          category: category ?? "Otros",
          description: a.description,
          source: "whatsapp",
          status: "confirmed",
          occurredAt: occurredAt(a.date, user),
        })
        .returning();
      return { line: `✅ ${describeTx(tx!, user.currency)}`, txId: tx!.id };
    }

    case "annotate":
    case "update": {
      const tx = a.tx_id !== null ? await getTransaction(user.id, a.tx_id) : undefined;
      if (!tx) return { line: "❓ No supe a qué gasto te refieres. Cita el mensaje del gasto y vuelve a intentarlo." };
      const [updated] = await db
        .update(transactions)
        .set({
          status: "confirmed",
          ...(category && { category }),
          ...(a.description && { description: a.description }),
          ...(a.amount !== null && a.amount > 0 && { amountMinor: toMinor(a.amount, a.currency ? currency : tx.currency) }),
          ...(a.currency && { currency }),
          ...(a.date && { occurredAt: occurredAt(a.date, user) }),
        })
        .where(eq(transactions.id, tx.id))
        .returning();
      const prefix = a.kind === "update" ? "✏️ Corregido:" : "✅";
      return { line: `${prefix} ${describeTx(updated!, user.currency)}`, txId: tx.id };
    }

    case "delete": {
      const tx = a.tx_id !== null ? await getTransaction(user.id, a.tx_id) : undefined;
      if (!tx) return { line: "❓ No supe qué gasto borrar." };
      await db.delete(transactions).where(eq(transactions.id, tx.id));
      return { line: `🗑️ Borrado: ${describeTx(tx, user.currency)}` };
    }

    case "query": {
      const period = a.period ?? "month";
      const summary = await summarize(user, period, { category });
      return { line: formatSummary(user, period, summary, category) };
    }

    case "smalltalk":
      return null; // El texto viene en `interpretation.reply`.
  }
}

/** "Ayer" u otra fecha → mediodía de ese día local; sin fecha → ahora. */
function occurredAt(date: string | null, user: User): Date {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date === localDate(new Date(), user.timezone)) return new Date();
  return new Date(startOfLocalDay(date, user.timezone).getTime() + 12 * 60 * 60 * 1000);
}
