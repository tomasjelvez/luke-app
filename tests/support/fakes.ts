import { vi } from "vitest";

/** Mensajes de WhatsApp "enviados" durante el test. */
export const sent: { to: string; body: string; buttons?: { id: string; title: string }[] }[] = [];

export const whatsappMock = {
  sendText: vi.fn(async (to: { phone: string }, body: string) => {
    sent.push({ to: to.phone, body });
    return true;
  }),
  sendButtons: vi.fn(async (to: { phone: string }, body: string, buttons: { id: string; title: string }[]) => {
    sent.push({ to: to.phone, body, buttons });
    return true;
  }),
  markReadWithTyping: vi.fn(async () => {}),
  waLink: (text: string) => `https://wa.me/56920403095?text=${encodeURIComponent(text)}`,
};

export const llmMock = {
  suggestCategory: vi.fn(async () => "Otros"),
  interpretMessage: vi.fn(async () => ({ actions: [], reply: "ok" })),
};
