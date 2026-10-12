import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const Env = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  // The app's public URL (WhatsApp links, secure cookies, CSRF check).
  PUBLIC_URL: z.string().url().optional(),

  KAPSO_API_KEY: z.string().min(1),
  KAPSO_PHONE_NUMBER_ID: z.string().min(1),
  KAPSO_WEBHOOK_SECRET: z.string().min(1),
  KAPSO_BASE_URL: z.string().default("https://app.kapso.ai/api/meta/"),
  // Luke's WhatsApp number, digits only, for the sign-up wa.me links.
  WHATSAPP_BOT_NUMBER: z.string().regex(/^\d{8,15}$/, "Digits only, no '+'"),

  LLM_MODEL: z.string().default("claude-opus-5"),

  // Account cap while sign-up is open (keeps Meta and Claude costs in check).
  MAX_USERS: z.coerce.number().int().positive().default(20),
  NIGHTLY_HOUR: z.coerce.number().int().min(0).max(23).default(21),

  // Shared Apple Pay Shortcut: iCloud link and the exact name it installs with.
  APPLE_PAY_SHORTCUT_URL: z.string().url().optional(),
  APPLE_PAY_SHORTCUT_NAME: z.string().min(1).default("Luke Apple Pay"),

  // Legacy single-user MVP: if set, that Apple Pay token is linked at startup to
  // that number's account, so the existing Shortcut keeps working.
  OWNER_PHONE: optional,
  APPLE_PAY_TOKEN: optional,
});

export type Config = z.infer<typeof Env> & { PUBLIC_URL: string };

export const config: Config = (() => {
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment variables (check .env):\n${issues}`);
  }
  const env = parsed.data;
  return { ...env, PUBLIC_URL: (env.PUBLIC_URL ?? `http://localhost:${env.PORT}`).replace(/\/$/, "") };
})();
