export const CATEGORIES = [
  "Supermercado",
  "Comida fuera",
  "Café",
  "Transporte",
  "Casa",
  "Cuentas y servicios",
  "Suscripciones",
  "Salud",
  "Ropa",
  "Ocio",
  "Viajes",
  "Regalos",
  "Otros",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_EMOJI: Record<Category, string> = {
  Supermercado: "🛒",
  "Comida fuera": "🍽️",
  Café: "☕",
  Transporte: "🚌",
  Casa: "🏠",
  "Cuentas y servicios": "💡",
  Suscripciones: "🔁",
  Salud: "💊",
  Ropa: "👕",
  Ocio: "🎉",
  Viajes: "✈️",
  Regalos: "🎁",
  Otros: "📦",
};

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}
