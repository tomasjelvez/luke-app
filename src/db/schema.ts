import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const txSource = pgEnum("tx_source", ["apple_pay", "whatsapp"]);
export const txStatus = pgEnum("tx_status", ["pending", "confirmed"]);
export const msgDirection = pgEnum("msg_direction", ["inbound", "outbound"]);
export const authPurpose = pgEnum("auth_purpose", ["signup", "login"]);
export const authStatus = pgEnum("auth_status", ["pending", "awaiting_confirmation", "verified", "consumed", "rejected"]);
export const sessionKind = pgEnum("session_kind", ["web", "mobile"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull().unique(),
  name: text("name"),
  timezone: text("timezone").notNull(),
  currency: text("currency").notNull(),
  // SHA-256 of the personal token the Apple Pay Shortcut uses (the token itself is never stored).
  applePayTokenHash: text("apple_pay_token_hash").unique(),
  // First purchase received via Apple Pay: confirms the Shortcut is set up correctly.
  applePayConnectedAt: timestamp("apple_pay_connected_at", { withTimezone: true }),
  // Last time the user messaged us: defines the WhatsApp 24h window.
  lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
  // Local date (YYYY-MM-DD) of the last nightly summary sent, to avoid repeating it.
  lastNightlyOn: date("last_nightly_on"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id),
    // Amount in the currency's minor units (cents for AUD, pesos for CLP).
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    merchant: text("merchant"),
    category: text("category").notNull(),
    description: text("description"),
    source: txSource("source").notNull(),
    status: txStatus("status").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    // When we asked the user about this expense (null = question queued).
    askedAt: timestamp("asked_at", { withTimezone: true }),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("transactions_user_occurred_idx").on(t.userId, t.occurredAt)],
);

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  // WhatsApp ID (wamid). Unique, since webhooks can be delivered twice.
  wamid: text("wamid").notNull().unique(),
  userId: integer("user_id").notNull().references(() => users.id),
  direction: msgDirection("direction").notNull(),
  type: text("type").notNull(),
  body: text("body"),
  // Expense the message refers to, to resolve quoted replies.
  transactionId: integer("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;

/**
 * Sign-up and login codes: the web generates the code and the person sends it to
 * Luke over WhatsApp, which proves the number is theirs.
 */
export const authCodes = pgTable("auth_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  purpose: authPurpose("purpose").notNull(),
  status: authStatus("status").notNull().default("pending"),
  // Sign-up form data (name, currency, time zone).
  signupData: jsonb("signup_data").$type<SignupData>(),
  // Only the browser/app that started the flow knows this secret and can claim the session.
  pollSecretHash: text("poll_secret_hash").notNull(),
  phone: text("phone"),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: sessionKind("kind").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export interface SignupData {
  name: string;
  currency: string;
  timezone: string;
}

export type AuthCode = typeof authCodes.$inferSelect;
