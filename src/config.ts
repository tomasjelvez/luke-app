import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),

  KAPSO_API_KEY: z.string().min(1),
  KAPSO_PHONE_NUMBER_ID: z.string().min(1),
  KAPSO_WEBHOOK_SECRET: z.string().min(1),
  KAPSO_BASE_URL: z.string().default("https://app.kapso.ai/api/meta/"),

  LLM_MODEL: z.string().default("claude-opus-5"),

  OWNER_PHONE: z.string().regex(/^\d{8,15}$/, "Número sin '+', solo dígitos"),
  OWNER_TIMEZONE: z.string().default("Australia/Sydney"),
  OWNER_CURRENCY: z.string().length(3).default("AUD"),
  APPLE_PAY_TOKEN: z.string().min(16, "Usa un token largo (openssl rand -hex 24)"),

  NIGHTLY_HOUR: z.coerce.number().int().min(0).max(23).default(21),
});

export type Config = z.infer<typeof Env>;

export const config: Config = (() => {
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Variables de entorno inválidas (revisa .env):\n${issues}`);
  }
  return parsed.data;
})();
