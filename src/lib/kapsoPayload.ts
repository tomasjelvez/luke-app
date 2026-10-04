import { z } from "zod";

// Solo validamos lo que usamos; el resto del payload de Kapso se ignora.
const InboundMessage = z.object({
  id: z.string(),
  type: z.string(),
  from: z.string().optional(),
  text: z.object({ body: z.string() }).optional(),
  interactive: z
    .object({
      type: z.string(),
      button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
    })
    .optional(),
  context: z.object({ id: z.string().optional() }).nullish(),
  kapso: z
    .object({
      transcript: z.object({ text: z.string() }).nullish(),
    })
    .passthrough()
    .optional(),
});

export const InboundEvent = z.object({
  message: InboundMessage,
  conversation: z.object({ phone_number: z.string().optional() }).passthrough().optional(),
  phone_number_id: z.string().optional(),
});

export type InboundEvent = z.infer<typeof InboundEvent>;

/** Kapso puede mandar un evento suelto o un lote (`batch: true, data: [...]`). */
export function extractEvents(body: unknown): InboundEvent[] {
  const batch = body as { batch?: unknown; data?: unknown };
  const items = batch?.batch === true && Array.isArray(batch.data) ? batch.data : [body];
  return items.flatMap((item) => {
    const parsed = InboundEvent.safeParse(item);
    if (!parsed.success) console.warn("[inbound] payload no reconocido", parsed.error.issues);
    return parsed.success ? [parsed.data] : [];
  });
}
