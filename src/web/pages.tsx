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
    document.getElementById("signup").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target, btn = f.querySelector("button"), err = document.getElementById("form-error");
      btn.disabled = true; err.textContent = "";
      try {
        await verifyWithWhatsApp("/api/auth/signup",
          { name: f.name.value, currency: f.currency.value, timezone: f.timezone.value },
          (m) => (document.getElementById("verify-error").textContent = m));
      } catch (e) { err.textContent = e.message; btn.disabled = false; }
    });`;
  return (
    <Layout title="Crear cuenta · Luke">
      <h1>Crea tu cuenta</h1>
      <p class="muted">Toma un minuto. Después conectamos tu Apple Pay.</p>
      <form id="step-form" class="card">
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
          body: JSON.stringify({ name: f.name.value, currency: f.currency.value, timezone: f.timezone.value }) });
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

      <form id="profile" class="card">
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

export function ApplePayPage(props: { user: User; url: string }) {
  const { user, url } = props;
  const script = `
    document.getElementById("gen").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      if (btn.dataset.existing === "1" && !confirm("El token anterior dejará de funcionar y tendrás que actualizar tu Atajo. ¿Continuar?")) return;
      btn.disabled = true;
      try {
        const r = await postJSON("/api/me/apple-pay-token");
        document.getElementById("auth-value").textContent = r.authorization;
        document.getElementById("token-box").hidden = false;
        btn.hidden = true;
        waitForConnection();
      } catch (e) { alert(e.message); btn.disabled = false; }
    });
    function waitForConnection() {
      const tick = async () => {
        const me = await fetch("/api/me").then((r) => r.json()).catch(() => null);
        if (me && me.applePay.connectedAt) {
          document.getElementById("waiting").hidden = true;
          document.getElementById("connected").hidden = false;
          return;
        }
        setTimeout(tick, 4000);
      };
      tick();
    }
    if (${user.applePayTokenHash !== null && !user.applePayConnectedAt}) waitForConnection();`;

  return (
    <Layout title="Apple Pay · Luke" loggedIn>
      <h1>Conecta tu Apple Pay</h1>
      <p class="muted">
        Creas una automatización en la app Atajos del iPhone (una sola vez). Cada vez que pagues con Apple Pay, el
        iPhone le avisa a Luke y Luke te pregunta qué fue.
      </p>

      <section id="connected" class="card ok" hidden={!user.applePayConnectedAt}>
        <h2>✅ ¡Conectado!</h2>
        <p class="small" style="margin:0">Luke ya recibe tus compras. Puedes borrar la acción “Show Notification” del Atajo.</p>
      </section>
      <section id="waiting" class="card warn" hidden={!!user.applePayConnectedAt}>
        <p class="status small" style="margin:0">
          <span class="dot live"></span>
          Cuando termines, paga algo con Apple Pay. Esta página se actualizará sola.
        </p>
      </section>

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
            Elige <span class="k">Wallet</span> <span class="alt">(o “Transacción”)</span>. Deja todas tus tarjetas y
            categorías marcadas → <span class="k">Next</span>.
          </li>
          <li>
            Elige <span class="k">Run Immediately</span> <span class="alt">(Ejecutar inmediatamente)</span> y desactiva{" "}
            <span class="k">Notify When Run</span> → <span class="k">Next</span> →{" "}
            <span class="k">New Blank Shortcut</span>.
          </li>
          <li>
            Agrega la acción <span class="k">URL</span> y pega la <span class="k">URL</span> de arriba.
          </li>
          <li>
            Agrega debajo <span class="k">Get Contents of URL</span>{" "}
            <span class="alt">(Obtener contenido de URL)</span> y toca la flechita para ver las opciones:
            <ul>
              <li>
                <span class="k">Method</span>: POST
              </li>
              <li>
                <span class="k">Headers</span> → Add new header: clave <code>Authorization</code>, valor: pega tu token
                (empieza con <code>Bearer</code>).
              </li>
              <li>
                <span class="k">Request Body</span>: JSON, con 3 campos de tipo Text. En cada uno elige la variable{" "}
                <span class="k">Shortcut Input</span>, tócala y elige la propiedad:
                <ul>
                  <li>
                    <code>amount</code> → <span class="k">Amount</span>
                  </li>
                  <li>
                    <code>merchant</code> → <span class="k">Merchant</span>
                  </li>
                  <li>
                    <code>card</code> → <span class="k">Card or Pass</span>
                  </li>
                </ul>
              </li>
            </ul>
          </li>
          <li>
            Para probar, agrega <span class="k">Show Notification</span> con la variable{" "}
            <span class="k">Contents of URL</span>. Toca ✓.
          </li>
          <li>Paga algo con Apple Pay: deberías recibir el mensaje de Luke en WhatsApp.</li>
        </ol>
      </section>
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </Layout>
  );
}
