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

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull().unique(),
  timezone: text("timezone").notNull(),
  currency: text("currency").notNull(),
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
