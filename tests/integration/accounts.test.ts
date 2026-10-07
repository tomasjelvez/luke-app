import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/whatsapp.js", async () => (await import("../support/fakes.js")).whatsappMock);
vi.mock("../../src/llm.js", async () => (await import("../support/fakes.js")).llmMock);

const { app } = await import("../../src/app.js");
const { db } = await import("../../src/db/client.js");
const { transactions, users } = await import("../../src/db/schema.js");
const { handleInbound } = await import("../../src/services/inbound.js");
const { runNightly } = await import("../../src/services/nightly.js");
const { bootstrapLegacyOwner, createUser } = await import("../../src/services/users.js");
const { sent } = await import("../support/fakes.js");
const { inbound, resetDb } = await import("../support/db.js");

const ANA = "61400000001";
const BEN = "61400000002";
const profile = { name: "Ana", currency: "AUD", timezone: "Australia/Sydney" };

let ip = 0;
async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: "POST",
    // IP distinta por request para no chocar con el límite de intentos (10 cada 15 min por IP).
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${++ip % 250}`, ...headers },
    body: JSON.stringify(body),
  });
}

function cookieFrom(res: Response): string {
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("sin cookie de sesión");
  return cookie;
}

/** Registro completo por la web + WhatsApp. Devuelve la cookie de sesión. */
async function signUp(phone: string, data = profile): Promise<string> {
  const started = await (await post("/api/auth/signup", data)).json();
  await handleInbound(inbound(phone, { text: `Hola Luke 👋 quiero registrarme. Mi código es ${started.code}` }));
  const res = await post("/api/auth/poll", { authId: started.authId, pollSecret: started.pollSecret });
  expect(await res.clone().json()).toMatchObject({ status: "verified" });
  return cookieFrom(res);
}

async function userByPhone(phone: string) {
  return (await db.query.users.findFirst({ where: eq(users.phone, phone) }))!;
}

beforeEach(resetDb);

describe("registro", () => {
  it("crea la cuenta cuando el código llega por WhatsApp y entrega la sesión a la web", async () => {
    const started = await (await post("/api/auth/signup", profile)).json();
    expect(started.code).toMatch(/^LUKE-[A-Z2-9]{6}$/);
    expect(started.whatsappUrl).toContain("wa.me/56920403095");

    const pending = await post("/api/auth/poll", { authId: started.authId, pollSecret: started.pollSecret });
    expect(await pending.json()).toEqual({ status: "pending" });

    await handleInbound(inbound(ANA, { text: `mi código es ${started.code.toLowerCase()}` }));
    expect(sent.at(-1)).toMatchObject({ to: ANA, body: expect.stringContaining("¡Hola, Ana!") });

    const res = await post("/api/auth/poll", { authId: started.authId, pollSecret: started.pollSecret });
    expect(await res.clone().json()).toMatchObject({ status: "verified", user: { name: "Ana", phone: ANA } });

    const me = await app.request("/api/me", { headers: { cookie: cookieFrom(res) } });
    expect(await me.json()).toMatchObject({ name: "Ana", currency: "AUD", applePay: { configured: false } });

    // La sesión se entrega una sola vez.
    const again = await post("/api/auth/poll", { authId: started.authId, pollSecret: started.pollSecret });
    expect(await again.json()).toEqual({ status: "not_found" });
  });

  it("no entrega la sesión a quien no tiene el secreto del navegador", async () => {
    const started = await (await post("/api/auth/signup", profile)).json();
    await handleInbound(inbound(ANA, { text: started.code }));
    const res = await post("/api/auth/poll", { authId: started.authId, pollSecret: "adivinado" });
    expect(await res.json()).toEqual({ status: "not_found" });
  });

  it("entrega un token de sesión (sin cookie) a la app móvil", async () => {
    const started = await (await post("/api/auth/signup", profile)).json();
    await handleInbound(inbound(ANA, { text: started.code }));
    const res = await post("/api/auth/poll", { authId: started.authId, pollSecret: started.pollSecret, client: "mobile" });
    const body = await res.json();
    expect(res.headers.get("set-cookie")).toBeNull();
    const me = await app.request("/api/me", { headers: { Authorization: `Bearer ${body.sessionToken}` } });
    expect(await me.json()).toMatchObject({ phone: ANA });
  });

  it("rechaza datos inválidos y respeta el tope de usuarios", async () => {
    expect((await post("/api/auth/signup", { ...profile, timezone: "Marte/Olympus" })).status).toBe(400);
    expect((await post("/api/auth/signup", { ...profile, name: "" })).status).toBe(400);

    for (const phone of ["61400000011", "61400000012", "61400000013"]) await createUser(phone, profile);
    expect((await post("/api/auth/signup", profile)).status).toBe(503);
  });

  it("a un número sin cuenta le responde con el link de registro", async () => {
    await handleInbound(inbound(ANA, { text: "hola" }));
    expect(sent).toEqual([{ to: ANA, body: expect.stringContaining("http://localhost:3000/registro") }]);
    expect(await db.query.users.findMany()).toHaveLength(0);
  });

  it("si el número ya tiene cuenta, pide confirmación en vez de crear otra", async () => {
    await signUp(ANA);
    const started = await (await post("/api/auth/signup", profile)).json();
    await handleInbound(inbound(ANA, { text: started.code }));
    expect(sent.at(-1)?.buttons?.map((b) => b.title)).toEqual(["Sí, soy yo", "No fui yo"]);
    expect(await db.query.users.findMany()).toHaveLength(1);
  });
});

describe("entrar", () => {
  it("requiere confirmar con el botón “Sí, soy yo”", async () => {
    await signUp(ANA);
    const started = await (await post("/api/auth/login", {})).json();
    await handleInbound(inbound(ANA, { text: `Mi código es ${started.code}` }));

    const buttons = sent.at(-1)?.buttons;
    expect(buttons?.[0]?.id).toMatch(/^auth_ok:\d+$/);
    const poll = () => post("/api/auth/poll", { authId: started.authId, pollSecret: started.pollSecret });
    expect(await (await poll()).json()).toEqual({ status: "awaiting_confirmation" });

    await handleInbound(inbound(ANA, { buttonId: buttons![0]!.id }));
    expect(await (await poll()).json()).toMatchObject({ status: "verified" });
  });

  it("“No fui yo” bloquea el intento", async () => {
    await signUp(ANA);
    const started = await (await post("/api/auth/login", {})).json();
    await handleInbound(inbound(ANA, { text: started.code }));
    await handleInbound(inbound(ANA, { buttonId: sent.at(-1)!.buttons![1]!.id }));
    const res = await post("/api/auth/poll", { authId: started.authId, pollSecret: started.pollSecret });
    expect(await res.json()).toEqual({ status: "rejected" });
  });

  it("un número sin cuenta no puede entrar", async () => {
    const started = await (await post("/api/auth/login", {})).json();
    await handleInbound(inbound(ANA, { text: started.code }));
    expect(sent.at(-1)?.body).toContain("/registro");
    const res = await post("/api/auth/poll", { authId: started.authId, pollSecret: started.pollSecret });
    expect(await res.json()).toEqual({ status: "rejected" });
  });

  it("nadie puede confirmar el login de otra persona", async () => {
    await signUp(ANA);
    await signUp(BEN, { ...profile, name: "Ben" });
    const started = await (await post("/api/auth/login", {})).json();
    await handleInbound(inbound(ANA, { text: started.code }));
    const okId = sent.at(-1)!.buttons![0]!.id;

    await handleInbound(inbound(BEN, { buttonId: okId }));
    const res = await post("/api/auth/poll", { authId: started.authId, pollSecret: started.pollSecret });
    expect(await res.json()).toEqual({ status: "awaiting_confirmation" });
  });

  it("cerrar sesión invalida la cookie", async () => {
    const cookie = await signUp(ANA);
    await post("/api/auth/logout", {}, { cookie });
    expect((await app.request("/api/me", { headers: { cookie } })).status).toBe(401);
  });
});

describe("Apple Pay por usuario", () => {
  it("cada token registra la compra en su propia cuenta y avisa la primera vez", async () => {
    const anaCookie = await signUp(ANA);
    const benCookie = await signUp(BEN, { ...profile, name: "Ben" });
    const anaToken = (await (await post("/api/me/apple-pay-token", {}, { cookie: anaCookie })).json()).token;
    const benToken = (await (await post("/api/me/apple-pay-token", {}, { cookie: benCookie })).json()).token;
    sent.length = 0;

    const pay = (token: string, merchant: string) =>
      post("/ingest/apple-pay", { amount: "$10.00", merchant }, { Authorization: `Bearer ${token}` });
    expect((await pay(anaToken, "Woolworths")).status).toBe(200);
    expect((await pay(benToken, "Coles")).status).toBe(200);
    expect((await pay("otro", "Aldi")).status).toBe(401);

    const ana = await userByPhone(ANA);
    const anaTx = await db.query.transactions.findMany({ where: eq(transactions.userId, ana.id) });
    expect(anaTx.map((t) => t.merchant)).toEqual(["Woolworths"]);
    expect(ana.applePayConnectedAt).not.toBeNull();
    expect(sent.filter((m) => m.to === ANA && m.body.includes("quedó conectado"))).toHaveLength(1);

    await pay(anaToken, "Woolworths Metro");
    expect(sent.filter((m) => m.body.includes("quedó conectado"))).toHaveLength(2); // uno por usuario
  });

  it("generar un token nuevo invalida el anterior", async () => {
    const cookie = await signUp(ANA);
    const first = (await (await post("/api/me/apple-pay-token", {}, { cookie })).json()).token;
    const second = (await (await post("/api/me/apple-pay-token", {}, { cookie })).json()).token;
    const pay = (token: string) =>
      post("/ingest/apple-pay", { amount: "$5", merchant: "Cafe" }, { Authorization: `Bearer ${token}` });
    expect((await pay(first)).status).toBe(401);
    expect((await pay(second)).status).toBe(200);
  });

  it("acepta la entrada cruda del Atajo compartido y extrae la compra", async () => {
    const cookie = await signUp(ANA);
    const token = (await (await post("/api/me/apple-pay-token", {}, { cookie })).json()).token;
    const res = await post("/ingest/apple-pay", { raw: "Ampol A$45.05 Debit Mastercard" }, { Authorization: `Bearer ${token}` });
    expect(await res.json()).toMatchObject({ status: "created" });
    const [tx] = await db.query.transactions.findMany();
    expect(tx).toMatchObject({ amountMinor: 4505, currency: "AUD", merchant: "Ampol", status: "pending" });
  });

  it("rechaza un pago sin monto ni entrada cruda", async () => {
    const cookie = await signUp(ANA);
    const token = (await (await post("/api/me/apple-pay-token", {}, { cookie })).json()).token;
    const res = await post("/ingest/apple-pay", { merchant: "", amount: "" }, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(400);
  });

  it("el Atajo compartido canjea el código de conexión por un token, una sola vez", async () => {
    const cookie = await signUp(ANA);
    const oldToken = (await (await post("/api/me/apple-pay-token", {}, { cookie })).json()).token;
    const setup = await (await post("/api/me/apple-pay-setup", {}, { cookie })).json();
    expect(setup.code).toMatch(/^luke-setup-/);
    expect(setup.runUrl).toBe(
      `shortcuts://run-shortcut?name=Luke%20Apple%20Pay&input=text&text=${encodeURIComponent(setup.code)}`,
    );

    const res = await post("/ingest/apple-pay/connect", { code: setup.code });
    const body = await res.json();
    expect(body).toMatchObject({ authorization: expect.stringMatching(/^Bearer /), confirm: expect.stringContaining("Ana") });
    expect(body.confirm).not.toContain(ANA); // el número va enmascarado

    const pay = (authorization: string) => post("/ingest/apple-pay", { amount: "$5", merchant: "Cafe" }, { Authorization: authorization });
    expect((await pay(body.authorization)).status).toBe(200);
    expect((await pay(`Bearer ${oldToken}`)).status).toBe(401);

    const again = await post("/ingest/apple-pay/connect", { code: setup.code });
    expect(again.status).toBe(400);
  });

  it("rechaza códigos de conexión vencidos o inventados", async () => {
    await signUp(ANA);
    const { createApplePaySetupCode } = await import("../../src/services/users.js");
    const ana = await userByPhone(ANA);
    const { code } = await createApplePaySetupCode(ana.id, new Date(Date.now() - 11 * 60 * 1000));
    expect((await post("/ingest/apple-pay/connect", { code })).status).toBe(400);
    expect((await post("/ingest/apple-pay/connect", { code: "luke-setup-inventado" })).status).toBe(400);
    expect((await post("/ingest/apple-pay/connect", {})).status).toBe(400);
  });

  it("el token heredado del MVP sigue funcionando para su dueño", async () => {
    await createUser("56911111111", { name: "Dueño", currency: "AUD", timezone: "Australia/Sydney" });
    await bootstrapLegacyOwner();
    const res = await post(
      "/ingest/apple-pay",
      { amount: "$3", merchant: "Kiosco" },
      { Authorization: "Bearer legacy-token-legacy-token" },
    );
    expect(res.status).toBe(200);
  });
});

describe("límite de intentos", () => {
  it("bloquea más de 10 registros seguidos desde la misma IP", async () => {
    const from = { "x-forwarded-for": "203.0.113.9" };
    const codes = [];
    for (let i = 0; i < 11; i++) codes.push((await post("/api/auth/login", {}, from)).status);
    expect(codes.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe("aislamiento entre usuarios", () => {
  it("no se puede confirmar ni ver un gasto ajeno", async () => {
    await signUp(ANA);
    const benCookie = await signUp(BEN, { ...profile, name: "Ben" });
    const ben = await userByPhone(BEN);
    const [benTx] = await db
      .insert(transactions)
      .values({
        userId: ben.id,
        amountMinor: 9900,
        currency: "AUD",
        merchant: "JB Hi-Fi",
        category: "Otros",
        source: "apple_pay",
        status: "pending",
        occurredAt: new Date(),
      })
      .returning();

    // Ana presiona un botón con el ID del gasto de Ben.
    await handleInbound(inbound(ANA, { buttonId: `ok:${benTx!.id}` }));
    expect(sent.at(-1)).toMatchObject({ to: ANA, body: expect.stringContaining("No encontré") });
    const after = await db.query.transactions.findFirst({ where: eq(transactions.id, benTx!.id) });
    expect(after?.status).toBe("pending");

    // Ben ve sus totales.
    const benSummary = await (await app.request("/api/me/summary", { headers: { cookie: benCookie } })).json();
    expect(benSummary.totals).toEqual([{ currency: "AUD", amountMinor: 9900, count: 1 }]);
  });
});

describe("resumen nocturno por zona horaria", () => {
  it("le llega a cada uno a las 21:00 de su zona", async () => {
    await signUp(ANA, { ...profile, timezone: "Australia/Sydney" });
    await signUp(BEN, { ...profile, name: "Ben", timezone: "America/Santiago" });
    sent.length = 0;

    // 10:30 UTC = 21:30 en Sydney (AEDT) y 07:30 en Santiago.
    await runNightly(new Date("2026-10-05T10:30:00Z"));
    expect(sent.map((m) => m.to)).toEqual([ANA]);

    // Una segunda pasada el mismo día no repite.
    await runNightly(new Date("2026-10-05T10:45:00Z"));
    expect(sent.map((m) => m.to)).toEqual([ANA]);
  });
});
