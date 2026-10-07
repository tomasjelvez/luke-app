import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { config } from "./config.js";
import { api } from "./http/api.js";
import { clientIp, sessionMiddleware, type AppEnv } from "./http/session.js";
import { extractEvents } from "./lib/kapsoPayload.js";
import { createRateLimiter } from "./lib/rateLimit.js";
import { verifyKapsoSignature } from "./lib/signature.js";
import { ApplePayPayload, ingestApplePay } from "./services/applePay.js";
import { handleInbound, senderPhone } from "./services/inbound.js";
import { claimApplePaySetupCode, findUserByApplePayToken } from "./services/users.js";
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

  const json: unknown = await c.req.json().catch(() => null);
  const body = ApplePayPayload.safeParse(json);
  if (!body.success) {
    // Diagnóstico: qué campos mandó el Atajo y de qué tipo (el token va en el header, no se registra).
    const fields = json && typeof json === "object" ? Object.entries(json).map(([k, v]) => `${k}:${Array.isArray(v) ? "array" : typeof v}`) : [typeof json];
    const raw = json && typeof json === "object" && "raw" in json ? JSON.stringify((json as { raw: unknown }).raw).slice(0, 300) : "-";
    console.warn(`[apple-pay] payload rechazado (usuario ${user.id}) campos=[${fields.join(", ")}] raw=${raw}`);
    return c.json({ error: "payload inválido", issues: body.error.issues }, 400);
  }

  const result = await ingestApplePay(user, body.data);
  if (result.status === "invalid_amount") return c.json({ error: `monto no reconocido: ${body.data.amount ?? "(desde raw)"}` }, 422);
  return c.json({ status: result.status, id: result.transaction.id, ...(result.status === "created" && { asked: result.asked }) });
});

// El Atajo compartido canjea el código de conexión (que le pasó la web) por su token personal.
const connectLimit = createRateLimiter(20, 15 * 60 * 1000);
app.post("/ingest/apple-pay/connect", async (c) => {
  if (!connectLimit(clientIp(c))) return c.json({ error: "Demasiados intentos, espera unos minutos." }, 429);
  const json: unknown = await c.req.json().catch(() => null);
  const code = json && typeof json === "object" && "code" in json && typeof json.code === "string" ? json.code : "";
  const claimed = code ? await claimApplePaySetupCode(code) : undefined;
  if (!claimed) {
    return c.json({ error: `Ese código no sirve o ya venció. Genera uno nuevo en ${config.PUBLIC_URL}/cuenta/apple-pay` }, 400);
  }
  const { user, token } = claimed;
  const owner = [user.name, `+${maskPhone(user.phone)}`].filter(Boolean).join(" · ");
  return c.json({
    authorization: `Bearer ${token}`,
    // El Atajo lo muestra antes de guardar el token, para que nadie conecte tu iPhone a otra cuenta.
    confirm: `¿Conectar este iPhone con la cuenta de Luke de ${owner}?`,
    message: "¡Listo! 🎉 Ahora crea la automatización de Wallet (el último paso en la página de Luke).",
  });
});

function maskPhone(phone: string): string {
  return phone.slice(0, 2) + "•".repeat(Math.max(0, phone.length - 6)) + phone.slice(-4);
}

// Web y API comparten la sesión (cookie en la web, Bearer en la app móvil).
app.use("/api/*", csrf({ origin: config.PUBLIC_URL }), sessionMiddleware);
app.route("/api", api);
app.use("*", sessionMiddleware);
app.route("/", web);
