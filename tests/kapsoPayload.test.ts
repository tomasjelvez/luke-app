import { describe, expect, it } from "vitest";
import { extractEvents } from "../src/lib/kapsoPayload.js";

const audio = {
  message: {
    id: "wamid.790",
    timestamp: "1730093100",
    type: "audio",
    from: "61412345678",
    audio: { id: "media_id_456" },
    kapso: { transcript: { text: "almuerzo quince dólares" }, media_url: "https://api.kapso.ai/media/x" },
  },
  conversation: { id: "conv_123", phone_number: "61412345678" },
  phone_number_id: "123",
};

describe("extractEvents", () => {
  it("reads a single event with an audio transcript", () => {
    const [e] = extractEvents(audio);
    expect(e?.message.kapso?.transcript?.text).toBe("almuerzo quince dólares");
  });

  it("reads batches", () => {
    expect(extractEvents({ type: "whatsapp.message.received", batch: true, data: [audio, audio] })).toHaveLength(2);
  });

  it("reads button replies and quoted messages", () => {
    const [e] = extractEvents({
      message: {
        id: "wamid.1",
        type: "interactive",
        from: "61412345678",
        context: { id: "wamid.0" },
        interactive: { type: "button_reply", button_reply: { id: "ok:12", title: "☕ Café" } },
      },
    });
    expect(e?.message.interactive?.button_reply?.id).toBe("ok:12");
    expect(e?.message.context?.id).toBe("wamid.0");
  });

  it("ignores unknown payloads", () => {
    expect(extractEvents({ foo: 1 })).toEqual([]);
  });
});
