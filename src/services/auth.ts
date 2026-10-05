import { and, eq, gt } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { authCodes, sessions, type AuthCode, type SignupData, type User } from "../db/schema.js";
import { generateCode, randomToken, sha256 } from "../lib/tokens.js";
import { sendButtons, sendText, waLink, type Recipient } from "../whatsapp.js";
import { createUser, findUserById, hasCapacity } from "./users.js";

const CODE_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = { web: 30 * 86_400_000, mobile: 90 * 86_400_000 } as const;
const TOUCH_SESSION_AFTER_MS = 60 * 60 * 1000;

export type SessionKind = keyof typeof SESSION_TTL_MS;

// --- Inicio del flujo (web o app) ---------------------------------------------

export interface StartedAuth {
  authId: number;
  code: string;
  pollSecret: string;
  expiresAt: Date;
  whatsappUrl: string;
}

export async function startAuth(purpose: "signup" | "login", signupData?: SignupData): Promise<StartedAuth> {
  const pollSecret = randomToken();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  // Reintenta si el código aleatorio choca con uno existente (muy improbable).
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const [row] = await db
      .insert(authCodes)
      .values({ code, purpose, signupData, pollSecretHash: sha256(pollSecret), expiresAt })
      .onConflictDoNothing()
      .returning();
    if (row) {
      const greeting = purpose === "signup" ? "quiero registrarme" : "quiero entrar";
      return {
        authId: row.id,
        code,
        pollSecret,
        expiresAt,
        whatsappUrl: waLink(`Hola Luke 👋 ${greeting}. Mi código es ${code}`),
      };
    }
  }
  throw new Error("No se pudo generar un código único");
}

// --- Consulta del estado desde la web o la app -------------------------------

export type PollResult =
  | { status: "pending" | "awaiting_confirmation" | "expired" | "rejected" | "not_found" }
  | { status: "verified"; sessionToken: string; user: User };

export async function pollAuth(authId: number, pollSecret: string, kind: SessionKind, now = new Date()): Promise<PollResult> {
  const row = await db.query.authCodes.findFirst({ where: eq(authCodes.id, authId) });
  if (!row || !safeEqualHex(row.pollSecretHash, sha256(pollSecret))) return { status: "not_found" };
  if (row.status === "rejected") return { status: "rejected" };
  if (row.status === "consumed") return { status: "not_found" };
  if (row.status !== "verified") return { status: row.expiresAt <= now ? "expired" : row.status };

  // Verificado: lo consumimos una sola vez y entregamos la sesión.
  const consumed = await db
    .update(authCodes)
    .set({ status: "consumed" })
    .where(and(eq(authCodes.id, row.id), eq(authCodes.status, "verified")))
    .returning();
  const user = row.userId ? await findUserById(row.userId) : undefined;
  if (consumed.length === 0 || !user) return { status: "not_found" };

  return { status: "verified", sessionToken: await createSession(user.id, kind, now), user };
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// --- El código llega por WhatsApp --------------------------------------------

/**
 * Procesa un mensaje de WhatsApp que trae un código de Luke. `user` es la cuenta
 * del número que escribe, si ya existe.
 */
export async function handleAuthCode(
  code: string,
  phone: string,
  user: User | undefined,
  replyTo: string,
  now = new Date(),
): Promise<void> {
  const to: Recipient = user ?? { phone, lastInboundAt: now };
  const row = await db.query.authCodes.findFirst({
    where: and(eq(authCodes.code, code), eq(authCodes.status, "pending"), gt(authCodes.expiresAt, now)),
  });

  if (!row) {
    await sendText(
      to,
      `Ese código ya no es válido (duran 15 minutos). Genera uno nuevo en ${config.PUBLIC_URL}/${user ? "entrar" : "registro"} 🔄`,
      { replyTo },
    );
    return;
  }

  // Registro de un número nuevo: creamos la cuenta al tiro.
  if (row.purpose === "signup" && !user) {
    if (!row.signupData || !(await hasCapacity())) {
      await setStatus(row, "rejected", { phone });
      await sendText(to, "Luke está completo por ahora 😕 Te avisaremos cuando abramos más cupos.", { replyTo });
      return;
    }
    const created = await createUser(phone, row.signupData, now);
    await setStatus(row, "verified", { phone, userId: created.id, verifiedAt: now });
    await sendText(
      created,
      `¡Hola, ${created.name}! 🎉 Tu cuenta en Luke quedó lista.\n\n` +
        `Vuelve a la página para conectar tu Apple Pay, o cuéntame tu primer gasto por aquí (ej. "café 5 dólares" o un audio 🎙️).`,
      { replyTo },
    );
    return;
  }

  // Login (o registro de un número que ya tiene cuenta): pedimos confirmación,
  // para que nadie pueda engañar a alguien para que le envíe su código.
  if (!user) {
    await setStatus(row, "rejected", { phone });
    await sendText(to, `No encontré una cuenta con este número. Regístrate en ${config.PUBLIC_URL}/registro ✨`, { replyTo });
    return;
  }
  await setStatus(row, "awaiting_confirmation", { phone, userId: user.id });
  await sendButtons(
    user,
    row.purpose === "signup"
      ? "Ya tienes una cuenta con este número 🙌 ¿Quieres entrar a Luke en la web con ella?"
      : "¿Estás entrando a Luke en la web? Confirma solo si fuiste tú 🔐",
    [
      { id: `auth_ok:${row.id}`, title: "Sí, soy yo" },
      { id: `auth_no:${row.id}`, title: "No fui yo" },
    ],
    { replyTo },
  );
}

/** Respuesta a los botones "Sí, soy yo" / "No fui yo". */
export async function confirmAuth(user: User, authId: number, approved: boolean, now = new Date()): Promise<void> {
  const row = await db.query.authCodes.findFirst({
    where: and(eq(authCodes.id, authId), eq(authCodes.userId, user.id), eq(authCodes.status, "awaiting_confirmation")),
  });
  if (!row || row.expiresAt <= now) {
    await sendText(user, "Esa solicitud ya no es válida. Si quieres entrar, genera un código nuevo en la web.");
    return;
  }
  if (approved) {
    await setStatus(row, "verified", { verifiedAt: now });
    await sendText(user, "✅ Listo, ya puedes seguir en la web.");
  } else {
    await setStatus(row, "rejected");
    await sendText(user, "Bloqueé ese intento 🛡️ Nadie entró a tu cuenta.");
  }
}

async function setStatus(row: AuthCode, status: AuthCode["status"], extra: Partial<AuthCode> = {}) {
  await db.update(authCodes).set({ status, ...extra }).where(eq(authCodes.id, row.id));
}

// --- Sesiones -----------------------------------------------------------------

export async function createSession(userId: number, kind: SessionKind, now = new Date()): Promise<string> {
  const token = randomToken();
  await db.insert(sessions).values({
    tokenHash: sha256(token),
    userId,
    kind,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS[kind]),
    lastUsedAt: now,
  });
  return token;
}

export async function getSessionUser(token: string, now = new Date()): Promise<User | undefined> {
  const session = await db.query.sessions.findFirst({
    where: and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, now)),
  });
  if (!session) return undefined;
  if (now.getTime() - session.lastUsedAt.getTime() > TOUCH_SESSION_AFTER_MS) {
    await db.update(sessions).set({ lastUsedAt: now }).where(eq(sessions.id, session.id));
  }
  return findUserById(session.userId);
}

export async function deleteSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

