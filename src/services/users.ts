import { and, count, eq, isNull } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { users, type SignupData, type User } from "../db/schema.js";
import { randomToken, sha256 } from "../lib/tokens.js";

export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

export async function findUserByPhone(phone: string): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.phone, normalizePhone(phone)) });
}

export async function findUserById(id: number): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.id, id) });
}

export async function findUserByApplePayToken(token: string): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.applePayTokenHash, sha256(token)) });
}

export async function countUsers(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(users);
  return row?.n ?? 0;
}

export async function hasCapacity(): Promise<boolean> {
  return (await countUsers()) < config.MAX_USERS;
}

export async function createUser(phone: string, data: SignupData, now = new Date()): Promise<User> {
  const [user] = await db
    .insert(users)
    .values({ phone: normalizePhone(phone), name: data.name, currency: data.currency, timezone: data.timezone, lastInboundAt: now })
    .returning();
  return user!;
}

export async function touchInbound(user: User, at: Date): Promise<User> {
  const [updated] = await db.update(users).set({ lastInboundAt: at }).where(eq(users.id, user.id)).returning();
  return updated!;
}

export async function updateProfile(userId: number, data: Partial<SignupData>): Promise<User> {
  const [updated] = await db.update(users).set(data).where(eq(users.id, userId)).returning();
  return updated!;
}

/** Generates a new Apple Pay token; the previous one stops working. The token is only returned this once. */
export async function rotateApplePayToken(userId: number): Promise<string> {
  const token = randomToken(24);
  await db
    .update(users)
    .set({ applePayTokenHash: sha256(token), applePayConnectedAt: null })
    .where(eq(users.id, userId));
  return token;
}

/** Marks Apple Pay as connected. Returns true only the first time. */
export async function markApplePayConnected(userId: number, at = new Date()): Promise<boolean> {
  const updated = await db
    .update(users)
    .set({ applePayConnectedAt: at })
    .where(and(eq(users.id, userId), isNull(users.applePayConnectedAt)))
    .returning({ id: users.id });
  return updated.length > 0;
}

/**
 * Migration from the single-user MVP: links the `APPLE_PAY_TOKEN` env var to the
 * `OWNER_PHONE` account, so its Shortcut keeps working unchanged.
 */
export async function bootstrapLegacyOwner(): Promise<void> {
  if (!config.OWNER_PHONE || !config.APPLE_PAY_TOKEN) return;
  const owner = await findUserByPhone(config.OWNER_PHONE);
  if (!owner || owner.applePayTokenHash) return;
  await db
    .update(users)
    .set({ applePayTokenHash: sha256(config.APPLE_PAY_TOKEN), applePayConnectedAt: owner.createdAt })
    .where(eq(users.id, owner.id));
  console.log(`[users] legacy Apple Pay token linked to user ${owner.id}`);
}
