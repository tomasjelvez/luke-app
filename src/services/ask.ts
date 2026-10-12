import type { Transaction, User } from "../db/schema.js";
import { formatMoney } from "../lib/money.js";
import { sendButtons, sendText } from "../whatsapp.js";
import { emoji, markAsked, unaskedPending } from "./expenses.js";

const MAX_INDIVIDUAL_QUESTIONS = 3;

/** Asks about an automatically detected expense. Returns false if the window is closed. */
export async function askAbout(user: User, tx: Transaction): Promise<boolean> {
  const amount = formatMoney(tx.amountMinor, tx.currency, user.currency);
  const sent = await sendButtons(
    user,
    `💳 ${amount} en ${tx.merchant ?? "un comercio"}. ¿Qué fue?\n\nConfirma la categoría o respóndeme con un audio o texto.`,
    [
      { id: `ok:${tx.id}`, title: `${emoji(tx.category)} ${tx.category}` },
      { id: `other:${tx.id}`, title: "Otra cosa" },
    ],
    { transactionId: tx.id },
  );
  if (sent) await markAsked([tx.id]);
  return sent;
}

/** Sends the questions queued while the 24h window was closed. */
export async function flushQueuedQuestions(user: User): Promise<void> {
  const queued = await unaskedPending(user.id);
  if (queued.length === 0) return;

  if (queued.length <= MAX_INDIVIDUAL_QUESTIONS) {
    for (const tx of queued) if (!(await askAbout(user, tx))) return;
    return;
  }

  const list = queued
    .slice(0, 10)
    .map((tx) => `• ${formatMoney(tx.amountMinor, tx.currency, user.currency)} en ${tx.merchant ?? "?"} (${emoji(tx.category)} ${tx.category})`)
    .join("\n");
  const more = queued.length > 10 ? `\n…y ${queued.length - 10} más.` : "";
  const sent = await sendText(
    user,
    `Tengo ${queued.length} compras sin contexto:\n${list}${more}\n\nCuéntame qué fueron (ej. "la de Coles era para el asado") o déjalas así con la categoría sugerida.`,
  );
  if (sent) await markAsked(queued.map((tx) => tx.id));
}
