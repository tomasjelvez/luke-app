# luke-app

Bot de WhatsApp para registrar gastos sin esfuerzo, con registro web y cuentas por número de WhatsApp.

- **Apple Pay → WhatsApp:** cada pago con Apple Pay llega por un Atajo de iOS; Luke lo registra y te pregunta "¿qué fue?" con botones.
- **Audios y texto:** "almuerzo 15 dólares", "8 lucas en el súper y 2 en café", "ayer pagué 40 de Uber".
- **Correcciones:** cita un mensaje y di "no, eran 30" o "bórralo".
- **Consultas:** "¿cuánto llevo esta semana?", "¿cuánto gasté en comida este mes?".
- **Resumen nocturno** (21:00 hora local) con lo del día, pendientes y la pregunta por gastos en efectivo.

Stack: Node + TypeScript, [Hono](https://hono.dev), Postgres + Drizzle, [Kapso](https://kapso.ai) (WhatsApp), Claude (interpretación).

## Cuentas

- **Registro:** `/registro` pide nombre y moneda (la zona horaria se detecta sola). La persona envía un código a Luke por WhatsApp (`wa.me` con el texto ya escrito) y así verifica su número, sin SMS ni contraseñas.
- **Entrar:** `/entrar` genera otro código; al enviarlo, Luke pide confirmar con "Sí, soy yo" para evitar que alguien engañe a otra persona para que le mande su código.
- **Apple Pay:** con el [Atajo compartido](#atajo-compartido-de-apple-pay), en `/cuenta/apple-pay` la persona copia su código con un toque, agrega el Atajo pegándolo, lo prueba una vez y crea la automatización de Wallet (una acción). Sigue existiendo la configuración manual con token personal (se guarda con hash). La página detecta sola la primera compra.
- **API para la app móvil:** las mismas rutas en `/api/*`; con `client: "mobile"` en `/api/auth/poll` se recibe un token de sesión para usar como `Authorization: Bearer`.
- Números sin cuenta que le escriben a Luke reciben el link de registro. `MAX_USERS` limita las cuentas mientras el registro sea abierto.

## Cómo funciona

```
iPhone (Atajo Apple Pay) ──POST──▶ /ingest/apple-pay ─┐
                                                      ├─▶ Postgres
WhatsApp ─▶ Kapso ──webhook──▶ /webhooks/kapso ───────┤
                                                      ├─▶ Claude (interpreta y categoriza)
Cron (cada 15 min) ─────────▶ resumen nocturno ───────┘   Kapso API (responde)
```

**Ventana de 24 h de WhatsApp:** el bot solo puede escribirte libremente si le escribiste en las últimas 24 h. Si está cerrada, las preguntas por compras de Apple Pay quedan **en cola** (el gasto igual queda registrado con su categoría sugerida) y salen la próxima vez que le escribas. En producción esto se resolverá con una plantilla de utilidad; el sandbox no permite plantillas.

## Puesta en marcha local

### 1. Dependencias y base de datos

```bash
npm install
npm run db:up            # Postgres en Docker, puerto 5433
cp .env.example .env     # y completa las variables
```

### 2. Kapso (sandbox)

1. Crea la cuenta en [app.kapso.ai](https://app.kapso.ai) y genera una **API key** → `KAPSO_API_KEY`.
2. Activa el **sandbox**: registra tu número de WhatsApp y envía el código de 6 caracteres al número del sandbox (expira en 15 min).
3. Copia el **phone number ID** del sandbox → `KAPSO_PHONE_NUMBER_ID`.
4. Agrega un webhook para el evento `whatsapp.message.received` apuntando a `https://<tu-túnel>/webhooks/kapso`, y copia su secreto → `KAPSO_WEBHOOK_SECRET`.

### 3. Resto del `.env`

- `ANTHROPIC_API_KEY`: tu API key de Claude.
- `OWNER_PHONE`: tu número, solo dígitos (ej. `61412345678`). Los mensajes de otros números se ignoran.
- `APPLE_PAY_TOKEN`: genera uno con `openssl rand -hex 24`.

### 4. Levantar el servidor y el túnel

```bash
npm run dev
# en otra terminal, para que Kapso y el iPhone lleguen a tu máquina:
cloudflared tunnel --url http://localhost:3000   # brew install cloudflared
```

Las migraciones se aplican solas al arrancar. Escríbele "hola" al número del sandbox para abrir la ventana de 24 h.

## Atajo compartido de Apple Pay

Un solo Atajo (**Luke Apple Pay**) sirve para todos los usuarios. Tiene 4 acciones y ninguna lógica:

1. **Text**: el código personal, que se pega al agregar el Atajo (pregunta de importación)
2. **Get Contents of URL**: `POST /ingest/apple-pay`, header `Authorization: Bearer <código>`, JSON `raw` = Shortcut Input
3. **Get Dictionary Value** `message`
4. **Show Notification** con ese mensaje

El servidor decide qué responder:

- **Sin compra** (`raw` vacío, el Atajo se abrió a mano): es la prueba de conexión. Responde "✅ Conectado a la cuenta de…".
- **Con compra:** la registra y responde "✅ Luke anotó…".
- **Error:** responde con un mensaje de error, por ejemplo cuando el código no es válido.

**Por qué el código va dentro del Atajo:** iOS no deja que una automatización lea archivos de iCloud Drive con el iPhone bloqueado. Una versión anterior guardaba el token en un archivo y fallaba en cada compra con el iPhone bloqueado.

**Por qué hay que probarlo una vez a mano:** la primera vez que el Atajo se conecta al servidor, iOS pide permiso. Con el iPhone bloqueado no lo puede pedir, así que la primera compra fallaría. Abrirlo a mano (el botón "Probar conexión", que usa `shortcuts://run-shortcut?name=…`) dispara el permiso con el iPhone desbloqueado.

Flujo del usuario en `/cuenta/apple-pay`:

1. Toca "Copiar mi código y agregar el Atajo": genera su token, lo copia al portapapeles y abre el link de iCloud. Agrega el Atajo y pega el código.
2. Toca "Probar conexión" y, si iOS pregunta, elige **Always Allow**.
3. Crea la automatización: **Wallet → Run Immediately → Run Shortcut "Luke Apple Pay"** (Input = Shortcut Input).

Apple no permite instalar la automatización de Wallet desde un link, así que ese paso lo hace cada persona.

### Crear el Atajo (una vez, quien administra Luke)

En un Mac:

```bash
python3 shortcut/build.py https://<servidor>
shortcuts sign --mode anyone -i shortcut/build/unsigned.shortcut -o "shortcut/build/Luke Apple Pay.shortcut"
open "shortcut/build/Luke Apple Pay.shortcut"
```

Al importarlo, el Atajo te pide el código: escribe cualquier cosa, porque al compartirlo esa respuesta se borra. Después compártelo con **Copy iCloud Link** y pon el link en `APPLE_PAY_SHORTCUT_URL`. Antes de configurarlo, revisa que la versión compartida no traiga ningún token.

### Configuración manual (alternativa)

Sigue disponible en `/cuenta/apple-pay` → "Configuración manual". Genera un token personal y la persona arma la automatización a mano, con una acción **Get Contents of URL** (POST, header `Authorization: Bearer <token>`, cuerpo JSON `raw` = Shortcut Input).

Probar sin iPhone:

```bash
curl -X POST http://localhost:3000/ingest/apple-pay \
  -H "Authorization: Bearer $APPLE_PAY_TOKEN" -H "content-type: application/json" \
  -d '{"amount":"$12.50","merchant":"WOOLWORTHS 1234 SYDNEY"}'
```

El monto llega como texto formateado por iOS ("$12.50", "A$12.50", "CLP 4.500"); `src/lib/money.ts` lo interpreta según la moneda.

## Scripts

| Script | Qué hace |
|---|---|
| `npm run dev` | Servidor con recarga automática |
| `npm start` | Servidor (producción) |
| `npm test` | Tests unitarios y de integración (necesitan `npm run db:up`: crean la base `luke_test`) |
| `npm run typecheck` | Chequeo de tipos |
| `npm run db:up` | Postgres local en Docker |
| `npm run db:generate` | Genera una migración tras cambiar `src/db/schema.ts` |

## Estructura

```
src/
  index.ts             arranque: migraciones, cron, servidor
  app.ts               rutas Hono (webhook, Apple Pay, health)
  config.ts            variables de entorno validadas
  llm.ts               Claude: interpretar mensajes y sugerir categorías
  whatsapp.ts          Kapso: enviar texto/botones, respetando la ventana de 24 h
  categories.ts        categorías y emojis
  db/                  esquema Drizzle y cliente
  lib/                 montos, firma de webhooks, fechas, payloads de Kapso
  services/
    inbound.ts         mensajes entrantes (texto, audio, botones) → acciones
    applePay.ts        ingesta de Apple Pay (con deduplicación)
    ask.ts             preguntas por compras y cola de pendientes
    expenses.ts        consultas, resúmenes y formato
    nightly.ts         resumen nocturno
```

## Fuera del MVP (siguientes pasos)

- Plantilla de utilidad para escribir fuera de la ventana de 24 h (número de producción)
- Lectura de mails/notificaciones del banco y conciliación con la cartola
- Conversión de monedas (hoy los totales se muestran por moneda)
- Presupuestos, cuotas y metas de ahorro
- Fotos de boletas
- Multiusuario
