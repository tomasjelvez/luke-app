import { z } from "zod";

export const CURRENCIES = ["AUD", "CLP", "USD", "EUR", "GBP", "NZD", "ARS", "MXN", "COP", "PEN", "CAD"] as const;

export const ProfileInput = z.object({
  name: z.string({ error: "Escribe tu nombre" }).trim().min(1, "Escribe tu nombre").max(40, "El nombre es muy largo"),
  currency: z.enum(CURRENCIES, { error: "Elige una moneda" }),
  timezone: z.string({ error: "Falta la zona horaria" }).refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz) || tz === "UTC", "Zona horaria inválida"),
});
