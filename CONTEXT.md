# CONTEXT

Glossary for the Lalamove wrapper project — a replicable version of the TouristPads Lalamove automation for other businesses.

## Terms

**Escalation Engine** — The core transferable product: logic that repeatedly raises a Lalamove order's Priority Fee on a preset ramp while the order remains unmatched (ASSIGNING_DRIVER), anchored to the pickup time. Distinct from the TouristPads calendar-ingestion pipeline, which is explicitly out of scope.

**Escalation Ramp** — A preset schedule of Priority Fee amounts relative to pickup time (e.g. gentle bumps 30–15 min before pickup, aggressive bumps from 10 min). Configurable per business; the TouristPads values ($0.50 / $2 / $4) are one instance, not the definition.

**Priority Fee** — Lalamove's driver-attraction tip, set via `POST /v3/orders/{id}/priority-fee`. Replaces (must exceed) the previous amount; only settable before a driver accepts. Spends the business's prepaid Lalamove wallet.

**Operator** — The person at the adopting business who runs the system day to day. Assumed non-technical but equipped with an AI coding assistant for setup. The Guide is assistant-agnostic: it never assumes a specific vendor, and it steers toward native apps (e.g. ChatGPT's Codex tab, the Claude Code desktop app) rather than CLI installs — the Operator is not expected to open a terminal themselves.

**Booking Origination** — However an order enters the system. TouristPads originates from Google Calendar events in a house format; that mechanism is a TouristPads-ism and not part of the replicable core. For adopters, origination is a Telegram bot conversation: the Operator messages the bot an order, the bot books it and the same chat carries all lifecycle notifications.

**Last-Minute Order** — An order booked for pickup now or very soon, with no meaningful lead time. The first adopter uses Lalamove exclusively this way, so the Escalation Ramp anchors to booking time ("minutes since booked"), not pickup time. (TouristPads' pickup-time-anchored ramp remains valid for scheduled orders; the template supports the booking-time anchor as the primary mode.)

**The Guide** — The deliverable, split in two: a short human-facing Quickstart (what it does, what it costs, which accounts to create — the part a non-technical Operator actually reads, possibly as DOCX/PDF) and a machine-followable SETUP.md inside the Template Repo that the Operator's AI assistant executes.

**Template Repo** — A sanitized, configurable extraction of the TouristPads code (Lalamove client, Escalation Engine, Telegram bot, webhook worker) that adopters clone and configure. Adopters do not re-implement from prose.

**Base** — The adopter's fixed premises (the bakery), configured once. All v1 orders are Base → customer deliveries; there is no collection/inbound flow and no arbitrary A→B flow in v1.

**Order Message** — The fill-in template message the Operator sends the bot to book: customer address (text or Telegram location pin), customer name, phone, optional vehicle/time. The bot parses it, replies with a confirmation card showing the live Lalamove quote, and books only when the Operator taps Confirm. The wallet is never charged without a shown price.

## Settled decisions

- Guide before any SaaS. A multi-tenant website (businesses paste keys into a hosted service) is deferred until the guide proves useful to a real adopter.
- Each adopting business uses its own Lalamove API keys and wallet; we never take custody of credentials.
- The replicable core is booking + Escalation Engine, not calendar ingestion.
- Booking Origination for adopters is a Telegram bot; no local web UI, no CLI, no calendar dependency.
- Deliverable is Template Repo + split Guide (human Quickstart + machine SETUP.md), not a standalone document.
- WhatsApp customer notifications are cut from the template. The Guide mentions that TouristPads handles customer WhatsApp messaging via conciergr.com (Joshua's product, waitlist) as the pointer for adopters who want that.
- Runtime is all-Cloudflare: one Worker (cron triggers + Telegram webhook + Lalamove webhook + KV state). No always-on machine, no VPS. The Python pipeline is the reference implementation being ported, not the deliverable.
- Escalation is preset fire-and-forget with a hard per-order fee cap and a manual `/bump` override; no approve-each-bump flow, no daily cap (every bump is notified in the Operator's chat, so runaway spend is visible without a second rail).
- Singapore-only for v1. Geocoder is OneMap (free, no credit card, commercial use permitted under the Singapore Open Data Licence) — Google Places and the entire Google Cloud ceremony are out of the stack. OneMap's literal, non-fuzzy search is absorbed by the bot's flow: strip "Blk/Block" from input, geocode bare 6-digit numbers as postal codes, and present the top matches as tap-to-pick buttons so the Operator confirms the resolved address before the quote. The 3-day OneMap token is auto-renewed by the Worker (email+password stored as secrets); never a manual step.
- v1 supports both order modes: ASAP (no time given; ramp anchors to booking time) and scheduled (optional `time:` maps to `scheduleAt`; ramp anchors to pickup time with the late-booking anchor shift). The dual-anchor monitor logic ports from the TouristPads reference implementation.
- Working name: **lalamove-autobook**. Deliberately descriptive, not branded; naming is a productization decision deferred until after adopter validation.
- Repo is public, MIT-licensed.
- Guide's human Quickstart is authored in Markdown and rendered to DOCX for the friend; SETUP.md in the repo is the machine-followable path.
- The Guide is AI-assistant-agnostic and native-app-first: the Quickstart's instruction is "open your AI coding assistant — ChatGPT (Codex tab) or the Claude Code app both work — point it at this repo and tell it to follow SETUP.md". SETUP.md contains no vendor-specific commands or assumptions; anything it needs run in a terminal, the assistant runs, not the Operator.
