import { sql } from "drizzle-orm";
import { db } from "../../src/db/client.js";
import { sent } from "./fakes.js";

export async function resetDb() {
  await db.execute(sql`truncate messages, transactions, sessions, auth_codes, users restart identity cascade`);
  sent.length = 0;
}

let seq = 0;
/** Evento de Kapso "mensaje recibido" mínimo. */
export function inbound(from: string, msg: { text?: string; buttonId?: string; contextId?: string }) {
  const id = `wamid.test.${++seq}`;
  return {
    message: {
      id,
      type: msg.buttonId ? "interactive" : "text",
      from,
      ...(msg.text && { text: { body: msg.text } }),
      ...(msg.buttonId && { interactive: { type: "button_reply", button_reply: { id: msg.buttonId, title: "x" } } }),
      ...(msg.contextId && { context: { id: msg.contextId } }),
    },
  };
}
