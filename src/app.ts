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

// Each number's messages are processed one at a time, in arrival order, to avoid
// races (e.g. two voice notes in a row correcting the same expense). Different
// numbers are processed in parallel.
const queues = new Map<string, Promise<void>>();
export function enqueue(key: string, task: () => Promise<void>): Promise<void> {
  const next = (queues.get(key) ?? Promise.resolve())
    .then(task)
    .catch((err) => console.error("[queue] task failed", err))
    .finally(() => {
      if (queues.get(key) === next) queues.delete(key);
    });
  queues.set(key, next);
  return next;
}

app.get("/health", (c) => c.json({ ok: true }));

app.post("/webhooks/kapso", async (c) => {
  // The signature is computed over the raw body, before parsing the JSON.
  const raw = await c.req.text();
  if (!verifyKapsoSignature(raw, c.req.header("X-Webhook-Signature"), config.KAPSO_WEBHOOK_SECRET)) {
    return c.text("invalid signature", 401);
  }

  const event = c.req.header("X-Webhook-Event");
  if (event && event !== "whatsapp.message.received") return c.text("ignored");

  // Reply right away and process afterwards: Claude can take a few seconds and
  // Kapso retries if the webhook doesn't answer in time.
  for (const inbound of extractEvents(JSON.parse(raw))) {
    if (inbound.phone_number_id && inbound.phone_number_id !== config.KAPSO_PHONE_NUMBER_ID) {
      console.warn(`[webhook] got a message for phone_number_id ${inbound.phone_number_id}, but KAPSO_PHONE_NUMBER_ID is ${config.KAPSO_PHONE_NUMBER_ID}`);
    }
    void enqueue(senderPhone(inbound), () => handleInbound(inbound));
  }
  return c.text("ok");
});

// The Shortcut shows `message` as a notification: it's the only thing the person sees.
app.post("/ingest/apple-pay", async (c) => {
  const token = c.req.header("Authorization")?.match(/^Bearer (.+)$/)?.[1]?.trim();
  const user = token ? await findUserByApplePayToken(token) : undefined;
  if (!user) {
    const message = `❌ Tu código de Luke no es válido. Conéctate de nuevo en ${config.PUBLIC_URL}/cuenta/apple-pay`;
    return c.json({ error: "invalid token", message }, 401);
  }

  const json: unknown = await c.req.json().catch(() => null);
  // No purchase = the Shortcut was run by hand ("Probar conexión"). That way iOS asks for its permissions while
  // the iPhone is unlocked (it can't while locked, and the first purchase would fail), and the pasted code is validated.
  const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  if (json && typeof json === "object" && isEmpty((json as Record<string, unknown>).raw) && isEmpty((json as Record<string, unknown>).amount)) {
    // Only a real purchase asks for the Wallet-data permission, and it can't be granted while locked.
    const message =
      `✅ Conectado a la cuenta de Luke de ${user.name ?? `+${user.phone}`}. Ahora crea la automatización de Wallet. ` +
      `Tu primera compra hazla con el iPhone desbloqueado y elige “Always Allow”.`;
    return c.json({ status: "ok", message });
  }

  const body = ApplePayPayload.safeParse(json);
  if (!body.success) {
    // Diagnostics: which fields the Shortcut sent and their types (the token is in the header and isn't logged).
    const fields = json && typeof json === "object" ? Object.entries(json).map(([k, v]) => `${k}:${Array.isArray(v) ? "array" : typeof v}`) : [typeof json];
    const raw = json && typeof json === "object" && "raw" in json ? JSON.stringify((json as { raw: unknown }).raw).slice(0, 300) : "-";
    console.warn(`[apple-pay] payload rejected (user ${user.id}) fields=[${fields.join(", ")}] raw=${raw}`);
    return c.json({ error: "invalid payload", issues: body.error.issues, message: "⚠️ Luke no pudo leer esta compra." }, 400);
  }

  const result = await ingestApplePay(user, body.data);
  if (result.status === "invalid_amount") {
    const error = `unrecognized amount: ${body.data.amount ?? "(from raw)"}`;
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

// Web and API share the session (cookie on the web, Bearer in the mobile app).
app.use("/api/*", csrf({ origin: config.PUBLIC_URL }), sessionMiddleware);
app.route("/api", api);
app.use("*", sessionMiddleware);
app.route("/", web);
