import { WhatsAppClient } from "@kapso/whatsapp-cloud-api";
import { config } from "./config.js";
import { db } from "./db/client.js";
import { messages } from "./db/schema.js";
import { isWindowOpen } from "./lib/time.js";

const client = new WhatsAppClient({ baseUrl: config.KAPSO_BASE_URL, kapsoApiKey: config.KAPSO_API_KEY });
const phoneNumberId = config.KAPSO_PHONE_NUMBER_ID;

/**
 * A quién le escribimos. Puede ser un usuario registrado o alguien que todavía
 * no tiene cuenta (sin `id`), por ejemplo para mandarle el link de registro.
 */
export interface Recipient {
  id?: number;
  phone: string;
  lastInboundAt: Date | null;
}

interface SendOptions {
  /** Gasto al que se refiere el mensaje, para entender respuestas citadas. */
  transactionId?: number;
  /** Responde citando este mensaje. */
  replyTo?: string;
}

async function logOutbound(to: Recipient, wamid: string | undefined, type: string, body: string, opts: SendOptions) {
  if (!wamid || to.id === undefined) return;
  await db
    .insert(messages)
    .values({ wamid, userId: to.id, direction: "outbound", type, body, transactionId: opts.transactionId })
    .onConflictDoNothing();
}

/**
 * Envía texto libre. Fuera de la ventana de 24 h WhatsApp lo rechazaría, así
 * que devolvemos false y quien llama decide si deja la pregunta en cola.
 */
export async function sendText(to: Recipient, body: string, opts: SendOptions = {}): Promise<boolean> {
  if (!isWindowOpen(to.lastInboundAt)) return false;
  const res = await client.messages.sendText({
    phoneNumberId,
    to: to.phone,
    body,
    contextMessageId: opts.replyTo,
  });
  await logOutbound(to, res.messages[0]?.id, "text", body, opts);
  return true;
}

export async function sendButtons(
  to: Recipient,
  bodyText: string,
  buttons: { id: string; title: string }[],
  opts: SendOptions = {},
): Promise<boolean> {
  if (!isWindowOpen(to.lastInboundAt)) return false;
  const res = await client.messages.sendInteractiveButtons({
    phoneNumberId,
    to: to.phone,
    bodyText,
    // WhatsApp limita los títulos de botones a 20 caracteres.
    buttons: buttons.map((b) => ({ id: b.id, title: b.title.slice(0, 20) })),
    contextMessageId: opts.replyTo,
  });
  await logOutbound(to, res.messages[0]?.id, "interactive", bodyText, opts);
  return true;
}

/** Marca como leído y muestra "escribiendo…" mientras procesamos. */
export async function markReadWithTyping(messageId: string) {
  try {
    await client.messages.markRead({ phoneNumberId, messageId, typingIndicator: { type: "text" } });
  } catch (err) {
    console.warn("[whatsapp] markRead falló", err);
  }
}

/** Link que abre WhatsApp con un mensaje ya escrito para Luke. */
export function waLink(text: string): string {
  return `https://wa.me/${config.WHATSAPP_BOT_NUMBER}?text=${encodeURIComponent(text)}`;
}
