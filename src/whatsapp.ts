import { WhatsAppClient } from "@kapso/whatsapp-cloud-api";
import { config } from "./config.js";
import { db } from "./db/client.js";
import { messages } from "./db/schema.js";
import { isWindowOpen } from "./lib/time.js";

const client = new WhatsAppClient({ baseUrl: config.KAPSO_BASE_URL, kapsoApiKey: config.KAPSO_API_KEY });
const phoneNumberId = config.KAPSO_PHONE_NUMBER_ID;

/**
 * Who we're messaging. Either a registered user or someone without an account
 * yet (no `id`), e.g. to send them the sign-up link.
 */
export interface Recipient {
  id?: number;
  phone: string;
  lastInboundAt: Date | null;
}

interface SendOptions {
  /** Expense the message refers to, to understand quoted replies. */
  transactionId?: number;
  /** Reply quoting this message. */
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
 * Sends free-form text. WhatsApp would reject it outside the 24h window, so we
 * return false and the caller decides whether to queue the question.
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
    // WhatsApp limits button titles to 20 characters.
    buttons: buttons.map((b) => ({ id: b.id, title: b.title.slice(0, 20) })),
    contextMessageId: opts.replyTo,
  });
  await logOutbound(to, res.messages[0]?.id, "interactive", bodyText, opts);
  return true;
}

/** Marks as read and shows "typing…" while we process. */
export async function markReadWithTyping(messageId: string) {
  try {
    await client.messages.markRead({ phoneNumberId, messageId, typingIndicator: { type: "text" } });
  } catch (err) {
    console.warn("[whatsapp] markRead failed", err);
  }
}

/** Link that opens WhatsApp with a prefilled message to Luke. */
export function waLink(text: string): string {
  return `https://wa.me/${config.WHATSAPP_BOT_NUMBER}?text=${encodeURIComponent(text)}`;
}
