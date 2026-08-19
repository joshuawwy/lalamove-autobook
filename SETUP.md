# SETUP.md — machine-followable install guide

This file is written for an AI coding assistant (any vendor) driving the
setup on behalf of a non-technical operator. Assistant: follow the phases in
order, run the commands yourself, and ask the operator only for the items
marked **ASK THE OPERATOR**. Never paste secrets into chat logs you don't
control; put them straight into `wrangler secret put` prompts.

The result: a Cloudflare Worker running a private Telegram bot that books
Lalamove deliveries from the operator's fixed pickup location, with automatic
priority-fee escalation while Lalamove searches for a driver.

## Phase 0 — prerequisites

- Node.js 18+ and npm (`node --version`). Install from nodejs.org if missing.
- This repository cloned locally; run all commands from the repo root.
- `npm install`
- Sanity check the code before touching accounts: `npm test` and
  `npm run typecheck` must both pass.

## Phase 1 — accounts (operator creates, assistant guides)

Four free accounts. Walk the operator through each screen.

### 1a. Lalamove partner account
**ASK THE OPERATOR** to sign up at https://partnerportal.lalamove.com/ as a
business (they may need business registration documents). In the portal's
**Developers** tab there is a Sandbox/Production dropdown:
- **Sandbox** keys (`pk_test_...`/`sk_test_...`) are available immediately — use these first.
- **Production** keys require account approval plus a wallet top-up (any
  amount). Questions: partner.support@lalamove.com.

Collect: API key + API secret (start with sandbox).

### 1b. Telegram bot
**ASK THE OPERATOR** to open Telegram, message **@BotFather**, send `/newbot`,
and pick a name. Collect: the bot token (`123456:ABC-...`). The operator
should also open a chat with their new bot and press Start (the chat id is
captured in Phase 4).

### 1c. OneMap (Singapore government geocoder)
**ASK THE OPERATOR** to register at https://www.onemap.gov.sg/apidocs/register
(email + password, instant, no credit card). Collect: that email and password
— the Worker renews its own access token with them.

### 1d. Cloudflare
**ASK THE OPERATOR** to create a free account at https://dash.cloudflare.com/sign-up,
then create an API token: **My Profile → API Tokens → Create Token → Edit
Cloudflare Workers** template (default settings are fine). Collect: the API
token, and the **Account ID** (visible on the dashboard's right sidebar, or
under Workers & Pages → Overview).

## Phase 2 — configure

1. Export Cloudflare credentials for non-interactive wrangler (do not commit
   them; put them in the shell environment only):
   ```sh
   export CLOUDFLARE_API_TOKEN=...   # from 1d
   export CLOUDFLARE_ACCOUNT_ID=...  # from 1d
   ```
2. Create the KV namespace and copy its id into `wrangler.toml`:
   ```sh
   npx wrangler kv namespace create STATE
   ```
   Replace `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` in `wrangler.toml` with the id
   it prints.
3. Edit the `[vars]` block in `wrangler.toml`:
   - `BASE_NAME`, `BASE_PHONE` — the business name and a contact phone the
     driver can call (`+65...`).
   - `BASE_ADDRESS` — the full pickup address, including postal code.
   - `BASE_LAT` / `BASE_LNG` — coordinates for that address. Get them from
     OneMap: https://www.onemap.gov.sg/api/common/elastic/search?searchVal=POSTALCODE&returnGeom=Y&getAddrDetails=Y
     (LATITUDE/LONGITUDE fields) or Google Maps right-click → coordinates.
   - Leave `LALAMOVE_ENV = "sandbox"` for now.
   - The escalation numbers have sensible defaults; change them only if the
     operator asks (see README → Escalation).

## Phase 3 — secrets and deploy

Generate two random webhook secrets first:
```sh
openssl rand -hex 16   # run twice, once per secret below
```

Set all eight secrets (each command prompts for the value):
```sh
npx wrangler secret put LALAMOVE_API_KEY
npx wrangler secret put LALAMOVE_API_SECRET
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID          # placeholder "0" for now; fixed in Phase 4
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # first random hex
npx wrangler secret put LALAMOVE_WEBHOOK_SECRET   # second random hex
npx wrangler secret put ONEMAP_EMAIL
npx wrangler secret put ONEMAP_PASSWORD
```

Deploy:
```sh
npx wrangler deploy
```
Note the Worker URL it prints, e.g. `https://lalamove-autobook.<subdomain>.workers.dev`.
`curl https://<worker-url>/health` should return `OK`.

## Phase 4 — connect the webhooks

1. **Telegram → Worker.** Register the webhook (substitute the bot token,
   worker URL, and the TELEGRAM_WEBHOOK_SECRET value):
   ```sh
   curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
     -d "url=https://<worker-url>/telegram" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```
2. **Capture the chat id.** **ASK THE OPERATOR** to send `/start` to the bot.
   Because `TELEGRAM_CHAT_ID` is still the placeholder, the bot replies
   "This bot is private. (Your chat id is `<number>`.)". Set it for real:
   ```sh
   npx wrangler secret put TELEGRAM_CHAT_ID
   ```
   (Worker secrets take effect immediately; no redeploy needed.) `/start`
   should now return the usage message.
3. **Lalamove → Worker.** **ASK THE OPERATOR** to open the Lalamove Partner
   Portal → Developers → **Webhooks (Version 3)** for the SAME environment as
   the keys (sandbox now), and set the URL to:
   ```
   https://<worker-url>/lalamove/<LALAMOVE_WEBHOOK_SECRET value>
   ```

## Phase 5 — sandbox test

**ASK THE OPERATOR** (or do it for them via the bot) to send the bot:
```
to: 313 Orchard Rd
name: Test Order
phone: 91234567
```
Expected: an address confirmation (buttons if several matches), then a
confirmation card with a quoted price, then **✅ Book it** books a sandbox
order and a booked message with a tracking link arrives. `/status` shows the
order. `/cancel` cancels it. Sandbox orders cost nothing and no driver comes.

If a step fails, read the Worker logs: `npx wrangler tail`.

## Phase 6 — go to production

Once the operator's production keys are approved and the wallet is topped up:
1. `npx wrangler secret put LALAMOVE_API_KEY` / `LALAMOVE_API_SECRET` with the
   production values.
2. Change `LALAMOVE_ENV` to `"production"` in `wrangler.toml`, then
   `npx wrangler deploy`.
3. **ASK THE OPERATOR** to set the same webhook URL in the portal's
   **Production** webhook settings (webhooks are configured per environment).
4. Book one small real order at a quiet time to verify end-to-end, watching
   the fee escalation notifications arrive if no driver matches within 5
   minutes.

## Ongoing

- Nothing to keep alive: Cloudflare runs the Worker and the every-minute
  escalation cron. OneMap tokens renew themselves.
- Wallet top-ups happen at wallet.lalamove.com; a 402 error in a booking
  reply means the wallet is empty.
- To change escalation behavior, edit the `[vars]` in `wrangler.toml` and
  `npx wrangler deploy` again.
