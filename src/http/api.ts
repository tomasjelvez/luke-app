import { Hono } from "hono";
import { z } from "zod";
import { config } from "../config.js";
import type { User } from "../db/schema.js";
import { ProfileInput } from "../lib/profile.js";
import { createRateLimiter } from "../lib/rateLimit.js";
import { deleteSession, pollAuth, startAuth } from "../services/auth.js";
import { formatSummary, summarize } from "../services/expenses.js";
import { hasCapacity, rotateApplePayToken, updateProfile } from "../services/users.js";
import { clearSessionCookie, clientIp, setSessionCookie, type AppEnv } from "./session.js";

/** API JSON: la usa la web y la usará la app móvil. */
export const api = new Hono<AppEnv>();

const authStartLimit = createRateLimiter(10, 15 * 60 * 1000);
const pollLimit = createRateLimiter(240, 15 * 60 * 1000);

export function publicUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    currency: user.currency,
    timezone: user.timezone,
    applePay: {
      configured: user.applePayTokenHash !== null,
      connectedAt: user.applePayConnectedAt,
    },
  };
}

export function applePaySetup(token?: string) {
  return {
    url: `${config.PUBLIC_URL}/ingest/apple-pay`,
    ...(token && { token, authorization: `Bearer ${token}` }),
  };
}

// --- Registro y entrada --------------------------------------------------------

api.post("/auth/signup", async (c) => {
  if (!authStartLimit(clientIp(c))) return c.json({ error: "Demasiados intentos, espera unos minutos." }, 429);
  const body = ProfileInput.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? "Datos inválidos" }, 400);
  if (!(await hasCapacity())) return c.json({ error: "Luke está completo por ahora." }, 503);
  return c.json(await startAuth("signup", body.data));
});

api.post("/auth/login", async (c) => {
  if (!authStartLimit(clientIp(c))) return c.json({ error: "Demasiados intentos, espera unos minutos." }, 429);
  return c.json(await startAuth("login"));
});

const PollInput = z.object({
  authId: z.number().int(),
  pollSecret: z.string().min(1),
  client: z.enum(["web", "mobile"]).default("web"),
});

api.post("/auth/poll", async (c) => {
  if (!pollLimit(clientIp(c))) return c.json({ error: "Demasiadas consultas" }, 429);
  const body = PollInput.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Datos inválidos" }, 400);

  const result = await pollAuth(body.data.authId, body.data.pollSecret, body.data.client);
  if (result.status !== "verified") return c.json({ status: result.status });

  if (body.data.client === "web") {
    setSessionCookie(c, result.sessionToken);
    return c.json({ status: "verified", user: publicUser(result.user) });
  }
  return c.json({ status: "verified", sessionToken: result.sessionToken, user: publicUser(result.user) });
});

api.post("/auth/logout", async (c) => {
  const token = c.get("sessionToken");
  if (token) await deleteSession(token);
  clearSessionCookie(c);
  return c.json({ ok: true });
});

// --- Cuenta (requiere sesión) -------------------------------------------------------

const me = new Hono<AppEnv>();

me.use(async (c, next) => {
  if (!c.get("user")) return c.json({ error: "No has iniciado sesión" }, 401);
  await next();
});

me.get("/", (c) => c.json(publicUser(c.get("user")!)));

me.patch("/", async (c) => {
  const body = ProfileInput.partial().safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? "Datos inválidos" }, 400);
  return c.json(publicUser(await updateProfile(c.get("user")!.id, body.data)));
});

me.post("/apple-pay-token", async (c) => {
  const token = await rotateApplePayToken(c.get("user")!.id);
  return c.json(applePaySetup(token));
});

me.get("/summary", async (c) => {
  const period = z.enum(["today", "week", "month"]).catch("month").parse(c.req.query("period"));
  const user = c.get("user")!;
  const summary = await summarize(user, period);
  return c.json({ period, ...summary, text: formatSummary(user, period, summary) });
});

api.route("/me", me);
