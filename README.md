# lalamove-autobook

A private Telegram bot that books [Lalamove](https://www.lalamove.com) deliveries for a small business
and then **automatically escalates the priority fee** while Lalamove searches
for a driver — the feature Lalamove itself doesn't offer anywhere (app, web,
or API). Runs entirely on a free Cloudflare Worker: no server, nothing to
keep alive.

Extracted from the delivery automation that [TouristPads](https://touristpads.com) has run in
production in Singapore; generalized so any business can deploy it with its
own Lalamove account, wallet, and escalation presets.

## What using it looks like

The operator messages their private bot:

```
to: 313 Orchard Rd
name: Sarah Tan
phone: 91234567
notes: 2 boxes, fragile
```

The bot geocodes the address (tap-to-pick if ambiguous), shows a card with
the live quoted price, and books on **✅ Book it**. Then, hands-off:

- Booked with no driver after 5 minutes → the bot starts bumping the
  priority fee ($1 → $2 → … up to a hard cap), notifying each step.
- Driver assigned / picked up (with photo) / completed → notifications in
  the same chat.
- At the cap with still no driver → the bot asks whether to `/bump` higher
  or `/cancel`.

Scheduled orders work too (`time: 3pm`): the ramp then anchors to pickup
time — gentle half-dollar bumps from 30 minutes out, aggressive from 10.

## Architecture

```
Telegram app ──▶ ┌──────────────────────────────┐ ──▶ Lalamove API v3
 (operator)  ◀── │  Cloudflare Worker           │ ◀── Lalamove webhooks
                 │  /telegram   bot + booking   │
                 │  /lalamove   status webhooks │ ──▶ OneMap (geocoding)
                 │  cron (1 min) fee escalation │
                 │  KV: orders, drafts, dedup   │
                 └──────────────────────────────┘
```

Everything is one Worker (`src/index.ts`). The interesting parts:

| Module | What it does |
|---|---|
| `src/escalation.ts` | The ramp: dual-anchor (booking time for ASAP, pickup time for scheduled), per-order cap, must-exceed fee totals |
| `src/parse.ts` | Order Message parsing with helpful errors |
| `src/onemap.ts` | OneMap geocoding; token auto-renew; literal-search normalization |
| `src/lalamove.ts` | Lalamove v3 client (HMAC-SHA256), quote → order |
| `src/webhookFilter.ts` | Filters ~8 webhooks per order down to 4 notifications, dedup + driver-reassignment handling |
| `src/monitor.ts` | The every-minute cron that applies the ramp |

## Setup

Follow **[SETUP.md](SETUP.md)** — it's written to be executed by an AI coding
assistant (Claude Code, ChatGPT/Codex, etc.) on behalf of a non-technical
operator. Total ceremony: four free accounts (Lalamove, Telegram, OneMap,
Cloudflare), eight secrets, one deploy. Sandbox first, then production.

## Escalation configuration

All in `wrangler.toml` `[vars]`, fees in SGD. Fees are **totals**: Lalamove's
priority-fee call replaces the previous amount and must exceed it.

| Var | Default | Meaning |
|---|---|---|
| `ASAP_WAIT_MIN` | 5 | Organic-match wait before the first bump |
| `ASAP_STEP_FEE` | 1 | Fee total grows by this per interval |
| `ASAP_INTERVAL_MIN` | 5 | Minutes between bumps |
| `ORDER_FEE_CAP` | 5 | Hard per-order cap (both modes). Raise it if you use vans on scheduled orders — the van tier hits $5 fast |
| `GENTLE_START_MIN` / `GENTLE_END_MIN` / `GENTLE_FEE` | 30 / 15 / 0.5 | Scheduled: gentle tier window and per-interval fee |
| `AGGRESSIVE_START_MIN` / `AGGRESSIVE_FEE` / `AGGRESSIVE_FEE_VAN` | 10 / 2 / 4 | Scheduled: aggressive tier from N minutes before pickup |

The manual `/bump 2` command adds on top of the current fee and may exceed
the cap — deliberate operator action always wins.

## Scope and honesty notes

- **Singapore-only** as shipped (OneMap geocoding, `+65` phones, SGD, `SG`
  market). Other Lalamove markets need a different geocoder and small tweaks.
- One fixed pickup location (`BASE_*`), outbound deliveries only.
- One operator chat. This is a small-business tool, not a fleet dashboard.
- The bot spends the business's own prepaid Lalamove wallet — the cap and the
  price-confirm step exist so it never does so surprisingly.
- Customer-facing notifications (e.g. WhatsApp "your delivery is coming
  today") are deliberately out of scope — TouristPads handles that side with
  [conciergr.com](https://conciergr.com), a WhatsApp AI front-desk for small
  businesses (waitlist open).

## Development

```sh
npm test            # vitest — ramp, parsing, signing, webhook filtering
npm run typecheck
npx wrangler dev    # local dev server
```

MIT licensed. Built by [TouristPads](https://touristpads.com) / [@joshuawwy](https://github.com/joshuawwy).
