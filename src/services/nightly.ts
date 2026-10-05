import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { users, type User } from "../db/schema.js";
import { formatMoney } from "../lib/money.js";
import { isWindowOpen, localDate, localHour } from "../lib/time.js";
import { sendText } from "../whatsapp.js";
import { flushQueuedQuestions } from "./ask.js";
import { emoji, formatSummary, markAsked, pendingTransactions, summarize } from "./expenses.js";

/**
 * Se ejecuta cada 15 minutos; a cada usuario le envía el resumen una vez al día,
 * cuando ya pasó la hora configurada en su zona horaria. Así sobrevive a
 * reinicios del servidor sin duplicarse.
 */
export async function runNightly(now = new Date()): Promise<void> {
  const all = await db.query.users.findMany();
  for (const user of all) {
    try {
      await nightlyFor(user, now);
    } catch (err) {
      console.error(`[nightly] falló para el usuario ${user.id}`, err);
    }
  }
}

async function nightlyFor(user: User, now: Date): Promise<void> {
  const today = localDate(now, user.timezone);
  if (localHour(now, user.timezone) < config.NIGHTLY_HOUR || user.lastNightlyOn === today) return;

  if (!isWindowOpen(user.lastInboundAt, now)) {
    // Sin plantillas (sandbox) no podemos escribir fuera de la ventana de 24 h.
    await db.update(users).set({ lastNightlyOn: today }).where(eq(users.id, user.id));
    return;
  }

  const summary = await summarize(user, "today", { now });
  const pending = await pendingTransactions(user.id, 5);
  const lines = [`🌙 ${formatSummary(user, "today", summary)}`];
  if (pending.length > 0) {
    lines.push("", `Te quedan ${pending.length} por explicar:`);
    for (const tx of pending) {
      lines.push(`• ${formatMoney(tx.amountMinor, tx.currency, user.currency)} en ${tx.merchant ?? "?"} (${emoji(tx.category)} ${tx.category})`);
    }
  }
  lines.push("", "¿Pagaste algo en efectivo o se me escapó algo? Mándame un audio 🎙️");

  if (await sendText(user, lines.join("\n"))) {
    await db.update(users).set({ lastNightlyOn: today }).where(eq(users.id, user.id));
    // Los pendientes listados ya cuentan como preguntados; el resto sale en la cola.
    await markAsked(pending.filter((tx) => !tx.askedAt).map((tx) => tx.id));
    await flushQueuedQuestions(user);
  }
}
