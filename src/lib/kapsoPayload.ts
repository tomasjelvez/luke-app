import { z } from "zod";

// Only validate what we use; the rest of Kapso's payload is ignored.
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

/** Kapso may send a single event or a batch (`batch: true, data: [...]`). */
export function extractEvents(body: unknown): InboundEvent[] {
  const batch = body as { batch?: unknown; data?: unknown };
  const items = batch?.batch === true && Array.isArray(batch.data) ? batch.data : [body];
  return items.flatMap((item) => {
    const parsed = InboundEvent.safeParse(item);
    if (!parsed.success) console.warn("[inbound] unrecognized payload", parsed.error.issues);
    return parsed.success ? [parsed.data] : [];
  });
}
