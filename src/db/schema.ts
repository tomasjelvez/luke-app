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
  // SHA-256 del token personal que usa el Atajo de Apple Pay (nunca guardamos el token).
  applePayTokenHash: text("apple_pay_token_hash").unique(),
  // Primera compra recibida por Apple Pay: confirma que el Atajo quedó bien configurado.
  applePayConnectedAt: timestamp("apple_pay_connected_at", { withTimezone: true }),
  // Código de un solo uso para que el Atajo compartido obtenga el token sin que la persona lo pegue.
  applePaySetupHash: text("apple_pay_setup_hash").unique(),
  applePaySetupExpiresAt: timestamp("apple_pay_setup_expires_at", { withTimezone: true }),
  // Última vez que el usuario nos escribió: define la ventana de 24 h de WhatsApp.
  lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
  // Fecha local (YYYY-MM-DD) del último resumen nocturno enviado, para no repetirlo.
  lastNightlyOn: date("last_nightly_on"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id),
    // Monto en unidades menores de la moneda (centavos para AUD, pesos para CLP).
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    merchant: text("merchant"),
    category: text("category").notNull(),
    description: text("description"),
    source: txSource("source").notNull(),
    status: txStatus("status").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    // Cuándo le preguntamos al usuario por este gasto (null = pregunta en cola).
    askedAt: timestamp("asked_at", { withTimezone: true }),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("transactions_user_occurred_idx").on(t.userId, t.occurredAt)],
);

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  // ID de WhatsApp (wamid). Único: los webhooks pueden llegar repetidos.
  wamid: text("wamid").notNull().unique(),
  userId: integer("user_id").notNull().references(() => users.id),
  direction: msgDirection("direction").notNull(),
  type: text("type").notNull(),
  body: text("body"),
  // Gasto al que se refiere el mensaje, para resolver respuestas citadas.
  transactionId: integer("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;

/**
 * Códigos para registrarse o entrar: la web genera el código y la persona lo
 * envía a Luke por WhatsApp, lo que demuestra que el número es suyo.
 */
export const authCodes = pgTable("auth_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  purpose: authPurpose("purpose").notNull(),
  status: authStatus("status").notNull().default("pending"),
  // Datos del formulario de registro (nombre, moneda, zona horaria).
  signupData: jsonb("signup_data").$type<SignupData>(),
  // Solo el navegador/app que inició el flujo conoce este secreto y puede reclamar la sesión.
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
