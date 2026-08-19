# ADR 0001: All-Cloudflare runtime instead of reusing the working Python pipeline

## Status

Accepted (2026-08-19)

## Context

The reference implementation (TouristPads' `lalamove-automation`) is a Python
pipeline driven by cron on an always-on Mac Studio, plus a small Cloudflare
Worker for webhooks. It works and is battle-tested. Porting it to TypeScript
on a Worker was several days of extra work versus documenting the Python
as-is.

The adopter profile settled during design: a non-technical operator with an
AI assistant for setup, and **no always-on machine**. Every self-hosted
runtime option (VPS, spare laptop, Raspberry Pi) hands that operator the
failure modes documents can't fix: cron silently dead, disk full, machine
asleep, OS updates.

## Decision

Port the whole system — booking, Telegram bot, escalation monitor, webhook
receiver — into a single Cloudflare Worker with cron triggers and KV state.
The Python pipeline remains the reference, not the deliverable.

## Consequences

- Setup collapses to four free accounts and one `wrangler deploy`; nothing to
  keep alive; free tier covers a small business's volume comfortably.
- The battle-tested Python logic (fee-anchor shift, webhook dedup semantics,
  HMAC signing) had to be ported faithfully — unit tests pin the ported
  behavior to worked examples from the Python implementation, including an
  HMAC vector computed with the Python client's algorithm.
- Workers constraints apply: no long-lived processes (Telegram is a webhook,
  not polling), KV's eventual consistency (acceptable: single operator,
  single writer per key in practice).
- A future multi-tenant SaaS version starts from this codebase rather than a
  rewrite — the Worker is already the hosting shape that product would need.
