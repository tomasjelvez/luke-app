# Luke

A WhatsApp bot that tracks your expenses with as little effort as possible. Luke speaks Spanish; it has web sign-up and accounts tied to your WhatsApp number.

- **Apple Pay → WhatsApp:** every Apple Pay payment arrives through an iOS Shortcut. Luke records it and asks "¿qué fue?" ("what was it?") with buttons.
- **Voice notes and text:** "almuerzo 15 dólares", "8 lucas en el súper y 2 en café", "ayer pagué 40 de Uber".
- **Corrections:** quote a message and say "no, eran 30" or "bórralo".
- **Questions:** "¿cuánto llevo esta semana?", "¿cuánto gasté en comida este mes?".
- **Nightly summary** (21:00 local time) with the day's spending, pending items and a nudge about cash expenses.

Stack: Node + TypeScript, [Hono](https://hono.dev), Postgres + Drizzle, [Kapso](https://kapso.ai) (WhatsApp), Claude (message interpretation).

## Accounts

- **Sign-up:** `/registro` asks for a name and currency (the time zone is detected automatically). The person sends a code to Luke on WhatsApp (a `wa.me` link with the text prefilled), which verifies their number with no SMS and no passwords.
- **Login:** `/entrar` generates another code. When it arrives, Luke asks the person to confirm with "Sí, soy yo", so nobody can trick someone else into sending them their code.
- **Apple Pay:** with the [shared Shortcut](#shared-apple-pay-shortcut), on `/cuenta/apple-pay` the person copies their code with one tap, adds the Shortcut by pasting it, tests it once and creates the Wallet automation (a single action). A manual setup with a personal token (stored hashed) is still available. The page detects the first purchase on its own.
- **API for the mobile app:** the same routes under `/api/*`. Passing `client: "mobile"` to `/api/auth/poll` returns a session token to use as `Authorization: Bearer`.
- Numbers without an account that message Luke get the sign-up link. `MAX_USERS` caps the number of accounts while sign-up is open.

## How it works

```
iPhone (Apple Pay Shortcut) ──POST──▶ /ingest/apple-pay ─┐
                                                         ├─▶ Postgres
WhatsApp ─▶ Kapso ──webhook──▶ /webhooks/kapso ──────────┤
                                                         ├─▶ Claude (interprets and categorizes)
Cron (every 15 min) ────────▶ nightly summary ───────────┘   Kapso API (replies)
```

**WhatsApp's 24-hour window:** the bot can only message you freely if you wrote to it in the last 24 hours. When the window is closed, questions about Apple Pay purchases are **queued** (the expense is still recorded with its suggested category) and sent the next time you write. In production this will be solved with a utility template; the sandbox doesn't allow templates.

## Local setup

### 1. Dependencies and database

```bash
npm install
npm run db:up            # Postgres in Docker, port 5433
cp .env.example .env     # then fill in the variables
```

### 2. Kapso (sandbox)

1. Create an account at [app.kapso.ai](https://app.kapso.ai) and generate an **API key** → `KAPSO_API_KEY`.
2. Enable the **sandbox**: register your WhatsApp number and send the 6-character code to the sandbox number (it expires in 15 min).
3. Copy the sandbox **phone number ID** → `KAPSO_PHONE_NUMBER_ID`.
4. Add a webhook for the `whatsapp.message.received` event pointing to `https://<your-tunnel>/webhooks/kapso`, and copy its secret → `KAPSO_WEBHOOK_SECRET`.

### 3. The rest of `.env`

- `ANTHROPIC_API_KEY`: your Claude API key.
- `WHATSAPP_BOT_NUMBER`: Luke's WhatsApp number, digits only (used for the sign-up `wa.me` links).
- `OWNER_PHONE` and `APPLE_PAY_TOKEN` (optional): only for migrating the old single-user setup; see `.env.example`.

### 4. Run the server and the tunnel

```bash
npm run dev
# in another terminal, so Kapso and the iPhone can reach your machine:
cloudflared tunnel --url http://localhost:3000   # brew install cloudflared
```

Migrations run automatically at startup. Send "hola" to the sandbox number to open the 24-hour window.

## Shared Apple Pay Shortcut

A single Shortcut (**Luke Apple Pay**) works for every user. It has 4 actions and no logic:

1. **Text**: the personal code, pasted when adding the Shortcut (an import question)
2. **Get Contents of URL**: `POST /ingest/apple-pay`, header `Authorization: Bearer <code>`, JSON with `amount`, `merchant` and `card` (properties of the Wallet purchase) plus `raw` = Shortcut Input
3. **Get Dictionary Value** `message`
4. **Show Notification** with that message

The server decides what to reply:

- **No purchase** (empty `raw` and `amount`, i.e. the Shortcut was run by hand): it's the connection test. Replies "✅ Conectado a la cuenta de…".
- **A purchase:** records it and replies "✅ Luke anotó…".
- **An error:** replies with an error message, e.g. when the code is invalid.

**Why the Shortcut accepts `WFWalletTransactionContentItem` and sends properties:** if it doesn't accept that class, iOS turns the purchase into text and only the merchant survives, without the amount. With the class, the Shortcut can send `Amount`, `Merchant` and `Card or Pass`.

**Why the code lives inside the Shortcut:** iOS doesn't let an automation read iCloud Drive files while the iPhone is locked. An earlier version stored the token in a file and failed on every purchase made with the iPhone locked.

**Why it has to be run by hand once:** the first time the Shortcut connects to the server, iOS asks for permission. It can't ask while the iPhone is locked, so the first purchase would fail. Running it by hand (the "Probar conexión" button, which uses `shortcuts://run-shortcut?name=…`) triggers the prompt while the iPhone is unlocked.

User flow on `/cuenta/apple-pay`:

1. Tap "Copiar mi código y agregar el Atajo": this generates their token, copies it to the clipboard and opens the iCloud link. They add the Shortcut and paste the code.
2. Tap "Probar conexión" and, if iOS asks, choose **Always Allow**.
3. Create the automation: **Wallet → Run Immediately → Run Shortcut "Luke Apple Pay"** (Input = Shortcut Input).
4. Make the first purchase with the iPhone **unlocked** and, when iOS asks whether the Shortcut may share Wallet data, choose **Always Allow**. Only a real purchase triggers that prompt, and it can't be granted while locked: without this step, every purchase made with the iPhone locked fails.

Apple doesn't allow installing the Wallet automation from a link, so each person does that step themselves.

### Building the Shortcut (once, by whoever runs Luke)

On a Mac:

```bash
python3 shortcut/build.py https://<server>
shortcuts sign --mode anyone -i shortcut/build/unsigned.shortcut -o "shortcut/build/Luke Apple Pay.shortcut"
open "shortcut/build/Luke Apple Pay.shortcut"
```

When importing it, the Shortcut asks for the code: type anything, since the answer is stripped when sharing. Then share it with **Copy iCloud Link** and set that link as `APPLE_PAY_SHORTCUT_URL`. Before doing so, check that the shared version doesn't contain any token.

### Manual setup (alternative)

Still available on `/cuenta/apple-pay` → "Configuración manual". It generates a personal token and the person builds the automation by hand, with a **Get Contents of URL** action (POST, header `Authorization: Bearer <token>`, JSON body `raw` = Shortcut Input).

Testing without an iPhone:

```bash
curl -X POST http://localhost:3000/ingest/apple-pay \
  -H "Authorization: Bearer $APPLE_PAY_TOKEN" -H "content-type: application/json" \
  -d '{"amount":"$12.50","merchant":"WOOLWORTHS 1234 SYDNEY"}'
```

The amount arrives as text formatted by iOS ("$12.50", "A$12.50", "CLP 4.500"); `src/lib/money.ts` parses it according to the currency.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Server with hot reload |
| `npm start` | Server (production) |
| `npm test` | Unit and integration tests (need `npm run db:up`; they create the `luke_test` database) |
| `npm run typecheck` | Type check |
| `npm run db:up` | Local Postgres in Docker |
| `npm run db:generate` | Generates a migration after changing `src/db/schema.ts` |

## Structure

```
src/
  index.ts             startup: migrations, cron, server
  app.ts               Hono routes (webhook, Apple Pay, health)
  config.ts            validated environment variables
  llm.ts               Claude: interpret messages, suggest categories, extract purchases
  whatsapp.ts          Kapso: send text/buttons, respecting the 24-hour window
  categories.ts        categories and emojis
  db/                  Drizzle schema and client
  http/                JSON API and sessions (cookie or Bearer)
  web/                 server-rendered pages (sign-up, login, account, Apple Pay)
  lib/                 amounts, webhook signatures, dates, tokens, Kapso payloads
  services/
    inbound.ts         incoming messages (text, audio, buttons) → actions
    auth.ts            sign-up/login codes over WhatsApp and sessions
    users.ts           accounts and Apple Pay tokens
    applePay.ts        Apple Pay ingestion (with deduplication)
    ask.ts             purchase questions and the pending queue
    expenses.ts        queries, summaries and formatting
    nightly.ts         nightly summary
shortcut/build.py      builds the shared Apple Pay Shortcut
```

## Not in the MVP yet (next steps)

- A utility template to message outside the 24-hour window (production number)
- Reading bank emails/notifications and reconciling against the bank statement
- Currency conversion (totals are currently shown per currency)
- Budgets, instalments and savings goals
- Receipt photos
- Mobile app (Expo)
