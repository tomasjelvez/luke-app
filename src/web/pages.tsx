import type { User } from "../db/schema.js";
import { formatMoney } from "../lib/money.js";
import { CURRENCIES } from "../lib/profile.js";
import { emoji, type PeriodSummary } from "../services/expenses.js";
import { CopyField, Layout, VerifyStep } from "./layout.js";

export function LandingPage() {
  return (
    <Layout title="Luke">
      <h1>Tus gastos se registran solos.</h1>
      <p class="muted">
        Pagas con Apple Pay y Luke te pregunta por WhatsApp qué fue. Para lo demás, le mandas un audio: “8 lucas en el
        súper”.
      </p>
      <div class="card">
        <p>💳 Cada compra con Apple Pay queda anotada al instante.</p>
        <p>🎙️ Audios o texto para efectivo y correcciones.</p>
        <p style="margin:0">🌙 Un resumen cada noche y respuestas como “¿cuánto llevo este mes?”.</p>
      </div>
      <a class="btn" href="/registro">
        Crear mi cuenta
      </a>
      <a class="btn secondary" href="/entrar">
        Ya tengo cuenta
      </a>
    </Layout>
  );
}

export function SignupPage() {
  const script = `
    document.getElementById("tz").value = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    document.getElementById("step-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target, btn = f.querySelector("button"), err = document.getElementById("form-error");
      btn.disabled = true; err.textContent = "";
      try {
        // Ojo: f.name sería el atributo "name" del <form>, no el campo; por eso usamos FormData.
        await verifyWithWhatsApp("/api/auth/signup", Object.fromEntries(new FormData(f)),
          (m) => (document.getElementById("verify-error").textContent = m));
      } catch (e) { err.textContent = e.message; btn.disabled = false; }
    });`;
  return (
    <Layout title="Crear cuenta · Luke">
      <h1>Crea tu cuenta</h1>
      <p class="muted">Toma un minuto. Después conectamos tu Apple Pay.</p>
      <form id="step-form" class="card" method="post">
        <label for="name">¿Cómo te llamas?</label>
        <input id="name" name="name" autocomplete="given-name" required maxlength={40} />
        <label for="currency">Moneda principal</label>
        <select id="currency" name="currency">
          {CURRENCIES.map((c) => (
            <option value={c}>{c}</option>
          ))}
        </select>
        <input type="hidden" id="tz" name="timezone" />
        <p class="small muted" style="margin-top:12px">
          Usamos la zona horaria de este dispositivo para tu resumen nocturno.
        </p>
        <button class="btn" type="submit">
          Continuar con WhatsApp
        </button>
        <p class="error" id="form-error"></p>
      </form>
      <VerifyStep />
      <p class="small muted">
        ¿Ya tienes cuenta? <a href="/entrar">Entra acá</a>
      </p>
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </Layout>
  );
}

export function LoginPage() {
  const script = `
    document.getElementById("login").addEventListener("click", async (e) => {
      const btn = e.currentTarget, err = document.getElementById("form-error");
      btn.disabled = true; err.textContent = "";
      try {
        await verifyWithWhatsApp("/api/auth/login", {}, (m) => (document.getElementById("verify-error").textContent = m));
      } catch (e) { err.textContent = e.message; btn.disabled = false; }
    });`;
  return (
    <Layout title="Entrar · Luke">
      <h1>Entra a tu cuenta</h1>
      <section id="step-form" class="card">
        <p class="muted">Sin contraseñas: te pediremos enviarle un código a Luke desde tu WhatsApp.</p>
        <button id="login" class="btn" type="button">
          Entrar con WhatsApp
        </button>
        <p class="error" id="form-error"></p>
      </section>
      <VerifyStep />
      <p class="small muted">
        ¿No tienes cuenta? <a href="/registro">Créala acá</a>
      </p>
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </Layout>
  );
}

export function AccountPage(props: { user: User; month: PeriodSummary }) {
  const { user, month } = props;
  const script = `
    document.getElementById("profile").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target, msg = document.getElementById("profile-msg");
      try {
        const res = await fetch("/api/me", { method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify(Object.fromEntries(new FormData(f))) });
        const data = await res.json();
        msg.textContent = res.ok ? "Guardado ✓" : data.error;
      } catch { msg.textContent = "No se pudo guardar"; }
    });
    document.getElementById("logout").addEventListener("click", async () => {
      await postJSON("/api/auth/logout"); location.assign("/");
    });`;
  return (
    <Layout title="Mi cuenta · Luke" loggedIn>
      <h1>Hola{user.name ? `, ${user.name}` : ""} 👋</h1>
      <p class="muted">+{user.phone}</p>

      <section class={`card ${user.applePayConnectedAt ? "ok" : "warn"}`}>
        <h2>{user.applePayConnectedAt ? "✅ Apple Pay conectado" : "💳 Conecta tu Apple Pay"}</h2>
        <p class="small">
          {user.applePayConnectedAt
            ? "Luke recibe tus compras automáticamente."
            : "Configura el Atajo una vez y tus compras se registrarán solas."}
        </p>
        <a class="btn secondary" href="/cuenta/apple-pay">
          {user.applePayConnectedAt ? "Ver configuración" : "Configurar ahora"}
        </a>
      </section>

      <section class="card">
        <h2>Este mes</h2>
        {month.totals.length === 0 ? (
          <p class="muted small">Todavía no hay gastos. Escríbele a Luke por WhatsApp o paga con Apple Pay.</p>
        ) : (
          <>
            {month.totals.map((t) => (
              <p style="font-size:24px;font-weight:700;margin:0">
                {formatMoney(t.amountMinor, t.currency, user.currency)}{" "}
                <span class="small muted">({t.count} gastos)</span>
              </p>
            ))}
            <div style="margin-top:12px">
              {month.byCategory.slice(0, 8).map((c) => (
                <div class="row small">
                  <span>
                    {emoji(c.category)} {c.category}
                  </span>
                  <span>{formatMoney(c.amountMinor, c.currency, user.currency)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <form id="profile" class="card" method="post">
        <h2>Tus datos</h2>
        <label for="name">Nombre</label>
        <input id="name" name="name" value={user.name ?? ""} required maxlength={40} />
        <label for="currency">Moneda principal</label>
        <select id="currency" name="currency">
          {CURRENCIES.map((c) => (
            <option value={c} selected={c === user.currency}>
              {c}
            </option>
          ))}
        </select>
        <label for="timezone">Zona horaria</label>
        <input id="timezone" name="timezone" value={user.timezone} required />
        <button class="btn secondary" type="submit">
          Guardar
        </button>
        <p class="small muted" id="profile-msg" style="margin-top:8px"></p>
      </form>

      <button id="logout" class="btn link" type="button">
        Cerrar sesión
      </button>
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </Layout>
  );
}

export function ApplePayPage(props: {
  user: User;
  url: string;
  shortcutUrl?: string;
  shortcutName: string;
  runUrl: string;
}) {
  const { user, url, shortcutUrl, shortcutName, runUrl } = props;
  const script = `
    document.getElementById("connect")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget, err = document.getElementById("connect-error");
      if (btn.dataset.existing === "1" && !confirm("Tu código anterior dejará de funcionar. ¿Continuar?")) return;
      btn.disabled = true; err.textContent = "";
      const token = postJSON("/api/me/apple-pay-token").then((r) => r.token);
      // Safari solo deja copiar durante el toque: le pasamos la promesa en vez de esperar la respuesta.
      let copied = false;
      try {
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": token.then((t) => new Blob([t], { type: "text/plain" })) })]);
        copied = true;
      } catch {}
      try {
        document.getElementById("my-code").textContent = await token;
        document.getElementById("code-box").hidden = false;
        document.getElementById("copied").hidden = !copied;
        document.getElementById("connected").hidden = true;
        document.getElementById("waiting").hidden = false;
        waitForConnection(Date.now());
        if (copied) location.href = btn.dataset.shortcut;
      } catch (e) { err.textContent = e.message; }
      btn.disabled = false;
    });
    document.getElementById("gen").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      if (btn.dataset.existing === "1" && !confirm("El token anterior dejará de funcionar y tendrás que actualizar tu Atajo. ¿Continuar?")) return;
      btn.disabled = true;
      try {
        const r = await postJSON("/api/me/apple-pay-token");
        document.getElementById("auth-value").textContent = r.authorization;
        document.getElementById("token-box").hidden = false;
        btn.hidden = true;
        waitForConnection(Date.now());
      } catch (e) { alert(e.message); btn.disabled = false; }
    });
    // Espera la primera compra recibida después de "since" (no una conexión anterior).
    let waitingSince = null;
    function waitForConnection(since) {
      const running = waitingSince !== null;
      waitingSince = since;
      if (running) return;
      const tick = async () => {
        const me = await fetch("/api/me").then((r) => r.json()).catch(() => null);
        if (me && me.applePay.connectedAt && Date.parse(me.applePay.connectedAt) >= waitingSince) {
          document.getElementById("waiting").hidden = true;
          document.getElementById("connected").hidden = false;
          return;
        }
        setTimeout(tick, 4000);
      };
      tick();
    }
    if (${user.applePayTokenHash !== null && !user.applePayConnectedAt}) waitForConnection(0);`;

  return (
    <Layout title="Apple Pay · Luke" loggedIn>
      <h1>Conecta tu Apple Pay</h1>
      <p class="muted">
        Se configura una sola vez desde tu iPhone. Cada vez que pagues con Apple Pay, el iPhone le avisa a Luke y Luke
        te pregunta qué fue.
      </p>

      <section id="connected" class="card ok" hidden={!user.applePayConnectedAt}>
        <h2>✅ ¡Conectado!</h2>
        <p class="small" style="margin:0">Luke ya recibe tus compras.</p>
      </section>
      <section id="waiting" class="card warn" hidden={!!user.applePayConnectedAt}>
        <p class="status small" style="margin:0">
          <span class="dot live"></span>
          Cuando termines, paga algo con Apple Pay. Esta página se actualizará sola.
        </p>
      </section>

      {shortcutUrl && (
        <>
          <section class="card">
            <h2>1. Agrega el Atajo de Luke</h2>
            <p class="small muted">
              El botón copia tu código personal y abre el Atajo. Toca <span class="k">Add Shortcut</span>{" "}
              <span class="alt">(Agregar atajo)</span> y, cuando te lo pida, mantén presionado y elige{" "}
              <span class="k">Paste</span> <span class="alt">(Pegar)</span>.
              {user.applePayTokenHash && " Tu código anterior dejará de funcionar."}
            </p>
            <button
              id="connect"
              class="btn"
              type="button"
              data-shortcut={shortcutUrl}
              data-existing={user.applePayTokenHash ? "1" : "0"}
            >
              Copiar mi código y agregar el Atajo
            </button>
            <p class="error" id="connect-error"></p>
            <div id="code-box" hidden>
              <p class="small muted" id="copied">✓ Copiado. Si el Atajo no se abrió, usa el link de abajo.</p>
              <label>Tu código</label>
              <CopyField id="my-code" value="" />
              <a class="small" href={shortcutUrl} target="_blank" rel="noopener">
                Abrir el Atajo
              </a>
            </div>
          </section>

          <section class="card">
            <h2>2. Pruébalo</h2>
            <p class="small muted">
              Deberías ver “✅ Conectado”. Si iOS te pide permiso, elige <span class="k">Always Allow</span>{" "}
              <span class="alt">(Permitir siempre)</span>: así funciona aunque tu iPhone esté bloqueado.
            </p>
            <a class="btn secondary" href={runUrl}>
              Probar conexión
            </a>
          </section>

          <section class="card">
            <h2>3. Crea la automatización</h2>
            <p class="small muted">
              Apple no deja instalar este paso desde un link, pero es corto. Te mostramos los nombres en inglés y, al
              lado, en español.
            </p>
            <ol class="steps">
              <li>
                Abre <span class="k">Shortcuts</span> <span class="alt">(Atajos)</span> → pestaña 
                <span class="k">Automation</span> <span class="alt">(Automatización)</span> → <span class="k">+</span>.
              </li>
              <li>
                Elige <span class="k">Wallet</span>. Deja todas tus tarjetas y categorías marcadas → 
                <span class="k">Next</span> <span class="alt">(Siguiente)</span>.
              </li>
              <li>
                Elige <span class="k">Run Immediately</span> <span class="alt">(Ejecutar inmediatamente)</span> → 
                <span class="k">Next</span>.
              </li>
              <li>
                Busca <span class="k">Run Shortcut</span> <span class="alt">(Ejecutar atajo)</span>, agrégala y en 
                <span class="k">Shortcut</span> elige <span class="k">{shortcutName}</span>.
              </li>
              <li>
                Toca la flechita de la acción → <span class="k">Input</span> <span class="alt">(Entrada)</span> → elige 
                <span class="k">Shortcut Input</span> <span class="alt">(Entrada del atajo)</span>. Toca 
                <span class="k">Done</span>.
              </li>
              <li>Mándale un mensaje a Luke por WhatsApp y paga algo con Apple Pay: Luke te preguntará qué fue.</li>
            </ol>
          </section>
        </>
      )}

      <details class="manual" open={!shortcutUrl}>
        <summary class="small muted">Configuración manual (sin el Atajo compartido)</summary>
        <section class="card">
          <h2>1. Tu token personal</h2>
          <p class="small muted">
            Es la llave para que tu iPhone le envíe tus compras a tu cuenta. No lo compartas.
            {user.applePayTokenHash && " Ya tienes uno configurado; genera uno nuevo solo si lo perdiste."}
          </p>
          <button id="gen" class="btn" type="button" data-existing={user.applePayTokenHash ? "1" : "0"}>
            {user.applePayTokenHash ? "Generar un token nuevo" : "Generar mi token"}
          </button>
          <div id="token-box" hidden>
            <label>Header “Authorization”</label>
            <CopyField id="auth-value" value="" />
            <p class="small muted">Se muestra una sola vez. Si lo pierdes, genera otro.</p>
          </div>
          <label>URL</label>
          <CopyField id="url-value" value={url} />
        </section>

        <section class="card">
          <h2>2. Crea la automatización</h2>
          <p class="small muted">Te mostramos los nombres en inglés y, al lado, en español.</p>
          <ol class="steps">
            <li>
              Abre <span class="k">Shortcuts</span> <span class="alt">(Atajos)</span> → pestaña{" "}
              <span class="k">Automation</span> <span class="alt">(Automatización)</span> → <span class="k">+</span>.
            </li>
            <li>
              Elige <span class="k">Wallet</span>. Deja todas tus tarjetas y categorías marcadas →{" "}
              <span class="k">Next</span> <span class="alt">(Siguiente)</span>.
            </li>
            <li>
              Elige <span class="k">Run Immediately</span> <span class="alt">(Ejecutar inmediatamente)</span> →{" "}
              <span class="k">Next</span> → <span class="k">New Blank Shortcut</span>{" "}
              <span class="alt">(Nuevo atajo en blanco)</span>.
            </li>
            <li>
              Toca <span class="k">Search Actions</span>, busca <span class="k">Get Contents of URL</span>{" "}
              <span class="alt">(Obtener contenido de URL)</span> y agrégala.
            </li>
            <li>
              Toca <span class="k">URL</span> dentro de la acción y pega la <span class="k">URL</span> de arriba.
            </li>
            <li>
              Toca la flechita al lado de la acción para ver las opciones:
              <ul>
                <li>
                  <span class="k">Method</span>: <span class="k">POST</span>
                </li>
                <li>
                  <span class="k">Headers</span> → <span class="k">Add new header</span>: clave{" "}
                  <code>Authorization</code>, valor: pega tu token (empieza con <code>Bearer</code>).
                </li>
                <li>
                  <span class="k">Request Body</span>: <span class="k">JSON</span> →{" "}
                  <span class="k">Add new field</span> → <span class="k">Text</span>: clave <code>raw</code>, valor: la
                  variable <span class="k">Shortcut Input</span>. No elijas ninguna propiedad: déjala tal cual.
                </li>
              </ul>
            </li>
            <li>
              Toca <span class="k">▶</span> una vez. Si te pregunta, elige <span class="k">Always Allow</span>{" "}
              <span class="alt">(Permitir siempre)</span>. Verás un error porque no hubo pago: es normal.
            </li>
            <li>
              Toca <span class="k">✓</span> y luego <span class="k">Done</span>.
            </li>
            <li>
              Mándale un mensaje a Luke por WhatsApp y paga algo con Apple Pay: Luke te preguntará qué fue.
            </li>
          </ol>
        </section>
      </details>
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </Layout>
  );
}
