import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { config } from "./config.js";
import { verifyKapsoSignature } from "./lib/signature.js";
import { ApplePayPayload, ingestApplePay } from "./services/applePay.js";
import { ensureOwner } from "./services/expenses.js";
import { extractEvents } from "./lib/kapsoPayload.js";
import { handleInbound } from "./services/inbound.js";

export const app = new Hono();

// Procesamos los mensajes de a uno, en orden de llegada, para evitar carreras
// (ej. dos audios seguidos que corrigen el mismo gasto).
let queue: Promise<void> = Promise.resolve();
function enqueue(task: () => Promise<void>) {
  queue = queue.then(task).catch((err) => console.error("[queue] tarea falló", err));
}

app.get("/health", (c) => c.json({ ok: true }));

app.post("/webhooks/kapso", async (c) => {
  // La firma se calcula sobre el cuerpo crudo, antes de parsear el JSON.
  const raw = await c.req.text();
  if (!verifyKapsoSignature(raw, c.req.header("X-Webhook-Signature"), config.KAPSO_WEBHOOK_SECRET)) {
    return c.text("firma inválida", 401);
  }

  const event = c.req.header("X-Webhook-Event");
  if (event && event !== "whatsapp.message.received") return c.text("ignorado");

  // Respondemos de inmediato y procesamos después: Claude puede tardar unos
  // segundos y Kapso reintenta si el webhook no contesta a tiempo.
  for (const inbound of extractEvents(JSON.parse(raw))) {
    if (inbound.phone_number_id && inbound.phone_number_id !== config.KAPSO_PHONE_NUMBER_ID) {
      console.warn(`[webhook] llegó un mensaje al phone_number_id ${inbound.phone_number_id}, pero KAPSO_PHONE_NUMBER_ID es ${config.KAPSO_PHONE_NUMBER_ID}`);
    }
    enqueue(() => handleInbound(inbound));
  }
  return c.text("ok");
});

app.post("/ingest/apple-pay", bearerAuth({ token: config.APPLE_PAY_TOKEN }), async (c) => {
  const body = ApplePayPayload.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "payload inválido", issues: body.error.issues }, 400);

  const user = await ensureOwner(config.OWNER_PHONE, config.OWNER_TIMEZONE, config.OWNER_CURRENCY);
  const result = await ingestApplePay(user, body.data);
  if (result.status === "invalid_amount") return c.json({ error: `monto no reconocido: ${body.data.amount}` }, 422);
  return c.json({ status: result.status, id: result.transaction.id, ...(result.status === "created" && { asked: result.asked }) });
});
