# ADR 0002: OneMap for geocoding instead of Google Places

## Status

Accepted (2026-08-19)

## Context

The reference implementation geocodes with Google Places, which requires a
Google Cloud project, a billing card, and an API key — the single worst
credential ceremony in the setup for a non-technical adopter, and the only
remaining Google dependency after calendar ingestion was dropped.

OneMap (Singapore Land Authority) was live-tested as the alternative:
postal codes resolve exactly (SG postal codes are unique per building),
building/condo/POI names work well, results return WGS84 lat/lng directly,
registration is free with no credit card, and commercial use is permitted
under the Singapore Open Data Licence.

Known OneMap weaknesses: literal, non-fuzzy search ("Blk 123..." returns
zero results; typos and extra words degrade results), 3-day token expiry,
and weaker colloquial-name coverage than Google.

## Decision

Use OneMap exclusively. Mitigate its weaknesses in the bot flow rather than
keeping Google as a fallback:

- strip "Blk/Block" and unit numbers before querying; treat bare 6-digit
  input as a postal code (`normalizeSearchQuery`);
- always confirm the resolved address with the operator (pick-a-button when
  multiple matches) before quoting;
- accept a Telegram location pin whenever search finds nothing;
- auto-renew the token via KV cache (2.5-day TTL) with a 401 retry.

## Consequences

- Zero-cost, zero-billing-card geocoding; one less account in SETUP.md.
- This pins the template to Singapore. Other Lalamove markets need a
  different geocoder module — a deliberate v1 trade-off, revisit only if a
  non-SG adopter actually appears.
- Typo-heavy input is handled by the confirmation step, not by fuzzier
  search; the pinned Order Message example nudges operators toward postal
  codes, the input OneMap is perfect on.
