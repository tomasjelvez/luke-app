import { z } from "zod";

export const CURRENCIES = ["AUD", "CLP", "USD", "EUR", "GBP", "NZD", "ARS", "MXN", "COP", "PEN", "CAD"] as const;

export const ProfileInput = z.object({
  name: z.string().trim().min(1, "Escribe tu nombre").max(40),
  currency: z.enum(CURRENCIES),
  timezone: z.string().refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz) || tz === "UTC", "Zona horaria inválida"),
});
