import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { config } from "./config.js";
import { api } from "./http/api.js";
import { sessionMiddleware, type AppEnv } from "./http/session.js";
import { extractEvents } from "./lib/kapsoPayload.js";
import { formatMoney } from "./lib/money.js";
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

// El Atajo muestra `message` como notificación: es lo único que ve la persona.
app.post("/ingest/apple-pay", async (c) => {
  const token = c.req.header("Authorization")?.match(/^Bearer (.+)$/)?.[1]?.trim();
  const user = token ? await findUserByApplePayToken(token) : undefined;
  if (!user) {
    const message = `❌ Tu código de Luke no es válido. Conéctate de nuevo en ${config.PUBLIC_URL}/cuenta/apple-pay`;
    return c.json({ error: "token inválido", message }, 401);
  }

  const json: unknown = await c.req.json().catch(() => null);
  // Sin compra = el Atajo se abrió a mano ("Probar conexión"). Así iOS pide sus permisos con el
  // iPhone desbloqueado (bloqueado no puede pedirlos y la primera compra fallaría), y validamos el código pegado.
  const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  if (json && typeof json === "object" && isEmpty((json as Record<string, unknown>).raw) && isEmpty((json as Record<string, unknown>).amount)) {
    // El permiso para enviar datos de Wallet solo lo pide una compra real, y bloqueado no se puede conceder.
    const message =
      `✅ Conectado a la cuenta de Luke de ${user.name ?? `+${user.phone}`}. Ahora crea la automatización de Wallet. ` +
      `Tu primera compra hazla con el iPhone desbloqueado y elige “Always Allow”.`;
    return c.json({ status: "ok", message });
  }

  const body = ApplePayPayload.safeParse(json);
  if (!body.success) {
    // Diagnóstico: qué campos mandó el Atajo y de qué tipo (el token va en el header, no se registra).
    const fields = json && typeof json === "object" ? Object.entries(json).map(([k, v]) => `${k}:${Array.isArray(v) ? "array" : typeof v}`) : [typeof json];
    const raw = json && typeof json === "object" && "raw" in json ? JSON.stringify((json as { raw: unknown }).raw).slice(0, 300) : "-";
    console.warn(`[apple-pay] payload rechazado (usuario ${user.id}) campos=[${fields.join(", ")}] raw=${raw}`);
    return c.json({ error: "payload inválido", issues: body.error.issues, message: "⚠️ Luke no pudo leer esta compra." }, 400);
  }

  const result = await ingestApplePay(user, body.data);
  if (result.status === "invalid_amount") {
    const error = `monto no reconocido: ${body.data.amount ?? "(desde raw)"}`;
    return c.json({ error, message: "⚠️ Luke no pudo leer el monto de esta compra. Cuéntasela por WhatsApp." }, 422);
  }
  const tx = result.transaction;
  const spent = `${formatMoney(tx.amountMinor, tx.currency, user.currency)} en ${tx.merchant ?? "una compra"}`;
  const message =
    result.status === "duplicate"
      ? `Luke ya tenía anotada esta compra (${spent}).`
      : `✅ Luke anotó ${spent}.${result.asked ? " Te pregunto por WhatsApp qué fue." : ""}`;
  return c.json({ status: result.status, id: tx.id, ...(result.status === "created" && { asked: result.asked }), message });
});

// Web y API comparten la sesión (cookie en la web, Bearer en la app móvil).
app.use("/api/*", csrf({ origin: config.PUBLIC_URL }), sessionMiddleware);
app.route("/api", api);
app.use("*", sessionMiddleware);
app.route("/", web);
