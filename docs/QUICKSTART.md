# Lalamove Autobook — Quickstart

*Book Lalamove deliveries from Telegram, and let the bot raise the driver
fee automatically when nobody's picking up your order.*

## What this is

A private Telegram bot for your business. You send it a short message with
where the delivery is going, it shows you the price, and one tap books the
Lalamove order. Then it watches the order for you: if no driver has taken it
after five minutes, it starts adding a small priority fee — a dollar at a
time, every five minutes, up to a hard cap you control — which is usually
what it takes to get a driver during busy hours. You get a message at every
step: fee added, driver assigned (name, phone, plate), parcel picked up
(with the driver's photo), delivered.

Lalamove's own app makes you do all of that by hand — reopening the app to
tap "add tip" again and again. This does it while you're serving customers.

It runs on Cloudflare's free tier, uses **your own** Lalamove account and
wallet, and there's no server to maintain and nothing to keep switched on.
It never spends without showing you the price first, and automatic fees stop
at the cap (S$5 per order unless you change it).

## What you'll need

Four free sign-ups (the setup assistant walks you through each):

1. **Lalamove business account** — partnerportal.lalamove.com. Your API keys
   and your prepaid wallet; delivery fees come from here.
2. **Telegram bot** — created in one minute by messaging @BotFather.
3. **OneMap** — Singapore's official (free) address lookup.
4. **Cloudflare** — the free hosting the bot runs on.

Plus about an hour, mostly waiting on the Lalamove account approval.

## How to set it up

You don't need to be technical — an AI coding assistant does the work. Any
current one is fine: **ChatGPT** (its Codex coding tab) or the **Claude Code
app** both work well; use whichever you already have. Prefer the app
versions — you should never need to open a terminal yourself.

Tell it:

> Please set up https://github.com/joshuawwy/lalamove-autobook for me by
> following its SETUP.md. I'm a non-technical user — do the technical steps
> for me and tell me exactly what to do for the account sign-ups.

It will guide you through the four sign-ups, deploy the bot, and run a test
booking in Lalamove's sandbox (fake orders, no cost) before any real money
is involved.

## Day-to-day use

Message your bot:

    to: 313 Orchard Rd
    name: Sarah Tan
    phone: 91234567
    notes: 2 boxes, fragile

Tap **✅ Book it** on the price card. Done — notifications come to the same
chat. Postal codes work best for addresses. Add `time: 3pm` to schedule
ahead, `vehicle: van` for bigger loads. `/status`, `/bump 2`, `/cancel` and
`/help` do what they say.

## Good to know

- The bot only answers **your** chat — nobody else can spend your wallet.
- Automatic fees never pass the cap; if there's still no driver at the cap,
  the bot asks you whether to push higher or cancel.
- Top up your wallet at wallet.lalamove.com — if it runs dry, bookings fail
  with a clear message.

---

*Extracted from the delivery automation TouristPads runs in production in
Singapore. Want the other half of that setup — a WhatsApp assistant that
answers your customers, confirms their deliveries, and hands real
conversations to you? That's **conciergr.com** — waitlist open.*
