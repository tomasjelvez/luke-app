import type { Child } from "hono/jsx";

const CSS = `
:root {
  --bg: #f6f5f1; --surface: #ffffff; --text: #1d1d1b; --muted: #6b6a66; --border: #e4e2dc;
  --accent: #128c4b; --accent-text: #ffffff; --accent-soft: #e5f4ec; --warn-soft: #fdf3e1; --danger: #b42318;
  --radius: 14px;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #121311; --surface: #1c1d1b; --text: #f0efe9; --muted: #a3a29b; --border: #2e2f2c;
    --accent: #25b864; --accent-text: #08130c; --accent-soft: #15301f; --warn-soft: #33290f; --danger: #f97066; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
main { max-width: 520px; margin: 0 auto; padding: 24px 16px 64px; }
header.top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
.brand { font-weight: 700; font-size: 20px; text-decoration: none; color: var(--text); }
h1 { font-size: 28px; line-height: 1.2; margin: 0 0 8px; }
h2 { font-size: 18px; margin: 0 0 12px; }
p { margin: 0 0 12px; }
.muted { color: var(--muted); }
.small { font-size: 14px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; margin-bottom: 16px; }
.card.ok { background: var(--accent-soft); border-color: transparent; }
.card.warn { background: var(--warn-soft); border-color: transparent; }
label { display: block; font-weight: 600; font-size: 14px; margin: 14px 0 6px; }
input, select { width: 100%; padding: 12px; font-size: 16px; border-radius: 10px; border: 1px solid var(--border);
  background: var(--bg); color: var(--text); }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 14px 16px;
  border-radius: 12px; border: 0; font-size: 16px; font-weight: 600; cursor: pointer; text-decoration: none;
  background: var(--accent); color: var(--accent-text); margin-top: 16px; }
.btn.secondary { background: transparent; color: var(--text); border: 1px solid var(--border); }
.btn.link { background: none; color: var(--muted); width: auto; padding: 8px 0; font-weight: 500; }
.btn[disabled] { opacity: .6; cursor: default; }
.code { font: 600 22px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 2px; text-align: center;
  padding: 14px; border: 1px dashed var(--border); border-radius: 10px; margin: 12px 0; }
.copy { display: flex; gap: 8px; align-items: stretch; margin: 6px 0 12px; }
.copy code { flex: 1; min-width: 0; overflow-wrap: anywhere; font: 13px/1.4 ui-monospace, Menlo, monospace;
  padding: 10px; border-radius: 8px; background: var(--bg); border: 1px solid var(--border); }
.copy button { flex: none; padding: 0 14px; border-radius: 8px; border: 1px solid var(--border);
  background: var(--surface); color: var(--text); font-weight: 600; cursor: pointer; }
ol.steps { padding-left: 20px; margin: 0; }
ol.steps li { margin-bottom: 14px; }
ol.steps li ul { margin: 6px 0 0; padding-left: 18px; }
.k { font-weight: 600; }
.alt { color: var(--muted); font-size: 14px; }
.error { color: var(--danger); font-size: 14px; margin-top: 8px; min-height: 1em; }
.status { display: flex; align-items: center; gap: 10px; }
.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--muted); flex: none; }
.dot.live { background: var(--accent); animation: pulse 1.4s infinite; }
@keyframes pulse { 50% { opacity: .3; } }
.row { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--border); }
.row:last-child { border-bottom: 0; }
[hidden] { display: none !important; }
`;

// Utilidades compartidas por las páginas (copiar, POST JSON y el flujo de verificación por WhatsApp).
const CLIENT_JS = `
async function postJSON(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Algo falló, intenta de nuevo");
  return data;
}
function copyFrom(id, btn) {
  navigator.clipboard.writeText(document.getElementById(id).textContent.trim()).then(() => {
    const old = btn.textContent; btn.textContent = "¡Copiado!"; setTimeout(() => (btn.textContent = old), 1500);
  });
}
async function verifyWithWhatsApp(endpoint, body, onError) {
  const started = await postJSON(endpoint, body);
  document.getElementById("step-form").hidden = true;
  document.getElementById("step-verify").hidden = false;
  document.getElementById("code").textContent = started.code;
  document.getElementById("wa").href = started.whatsappUrl;
  const status = document.getElementById("verify-status");
  const poll = async () => {
    try {
      const r = await postJSON("/api/auth/poll", { authId: started.authId, pollSecret: started.pollSecret, client: "web" });
      if (r.status === "verified") return location.assign(endpoint.endsWith("signup") ? "/cuenta/apple-pay" : "/cuenta");
      if (r.status === "awaiting_confirmation") status.textContent = "Confirma en WhatsApp tocando “Sí, soy yo”…";
      if (r.status === "expired") return onError("El código venció. Recarga la página para generar otro.");
      if (r.status === "rejected") return onError("No se pudo verificar. Revisa el mensaje de Luke en WhatsApp.");
      if (r.status === "not_found") return onError("Algo falló. Recarga la página e intenta de nuevo.");
    } catch (e) {}
    setTimeout(poll, 2000);
  };
  poll();
}
`;

export function Layout(props: { title: string; children: Child; loggedIn?: boolean }) {
  return (
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>{props.title}</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <script dangerouslySetInnerHTML={{ __html: CLIENT_JS }} />
      </head>
      <body>
        <main>
          <header class="top">
            <a class="brand" href="/">
              💬 Luke
            </a>
            {props.loggedIn && (
              <a class="small muted" href="/cuenta">
                Mi cuenta
              </a>
            )}
          </header>
          {props.children}
        </main>
      </body>
    </html>
  );
}

export function CopyField(props: { id: string; value: string }) {
  return (
    <div class="copy">
      <code id={props.id}>{props.value}</code>
      <button type="button" onclick={`copyFrom('${props.id}', this)`}>
        Copiar
      </button>
    </div>
  );
}

/** Paso 2 del registro/entrada: enviar el código por WhatsApp y esperar. */
export function VerifyStep() {
  return (
    <section id="step-verify" class="card" hidden>
      <h2>Verifica tu número con WhatsApp</h2>
      <p class="muted">Envíale este código a Luke desde tu WhatsApp. El botón lo deja escrito por ti.</p>
      <div class="code" id="code"></div>
      <a id="wa" class="btn" href="#" target="_blank" rel="noopener">
        Abrir WhatsApp y enviar
      </a>
      <p class="status small muted" style="margin-top:16px">
        <span class="dot live"></span>
        <span id="verify-status">Esperando tu mensaje…</span>
      </p>
      <p class="error" id="verify-error"></p>
    </section>
  );
}
