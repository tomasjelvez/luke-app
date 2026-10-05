import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { config } from "../config.js";
import type { User } from "../db/schema.js";
import { getSessionUser } from "../services/auth.js";

export const SESSION_COOKIE = "luke_session";

export type AppEnv = { Variables: { user: User | undefined; sessionToken: string | undefined } };

/** Lee la sesión desde la cookie (web) o desde `Authorization: Bearer` (app móvil). */
export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const bearer = c.req.header("Authorization")?.match(/^Bearer (.+)$/)?.[1];
  const token = bearer ?? getCookie(c, SESSION_COOKIE);
  c.set("sessionToken", token);
  c.set("user", token ? await getSessionUser(token) : undefined);
  await next();
};

export function setSessionCookie(c: Context, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.PUBLIC_URL.startsWith("https://"),
    sameSite: "Lax",
    path: "/",
    maxAge: 30 * 86_400,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export function clientIp(c: Context): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "local";
}
