import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { config } from "./config.js";
import { api } from "./http/api.js";
import { sessionMiddleware, type AppEnv } from "./http/session.js";
import { extractEvents } from "./lib/kapsoPayload.js";
import { verifyKapsoSignature } from "./lib/signature.js";
import { ApplePayPayload, ingestApplePay } from "./services/applePay.js";
import { handleInbound, senderPhone } from "./services/inbound.js";
import { findUserByApplePayToken } from "./services/users.js";
import { web } from "./web/routes.js";

export const app = new Hono<AppEnv>();

// Procesamos los mensajes de cada número de a uno, en orden de llegada, para
// evitar carreras (ej. dos audios seguidos que corrigen el mismo gasto). Números
// distintos se procesan en paralelo.
const queues = new Map<string, Promise<void>>();
export function enqueue(key: string, task: () => Promise<void>): Promise<void> {
  const next = (queues.get(key) ?? Promise.resolve())
    .then(task)
    .catch((err) => console.error("[queue] tarea falló", err))
    .finally(() => {
      if (queues.get(key) === next) queues.delete(key);
    });
  queues.set(key, next);
  return next;
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
    void enqueue(senderPhone(inbound), () => handleInbound(inbound));
  }
  return c.text("ok");
});

app.post("/ingest/apple-pay", async (c) => {
  const token = c.req.header("Authorization")?.match(/^Bearer (.+)$/)?.[1]?.trim();
  const user = token ? await findUserByApplePayToken(token) : undefined;
  if (!user) return c.json({ error: "token inválido" }, 401);

  const body = ApplePayPayload.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "payload inválido", issues: body.error.issues }, 400);

  const result = await ingestApplePay(user, body.data);
  if (result.status === "invalid_amount") return c.json({ error: `monto no reconocido: ${body.data.amount}` }, 422);
  return c.json({ status: result.status, id: result.transaction.id, ...(result.status === "created" && { asked: result.asked }) });
});

// Web y API comparten la sesión (cookie en la web, Bearer en la app móvil).
app.use("/api/*", csrf({ origin: config.PUBLIC_URL }), sessionMiddleware);
app.route("/api", api);
app.use("*", sessionMiddleware);
app.route("/", web);
