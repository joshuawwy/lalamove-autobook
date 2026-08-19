// Order Message parsing: line-based "key: value" fields, forgiving about
// aliases, case, and surrounding chatter, strict about anything that would
// book the wrong thing (bad phone, ambiguous time).

import type { Vehicle } from "./escalation";

export interface ParsedOrder {
  addressQuery: string;
  name: string;
  phone: string;
  vehicle: Vehicle;
  notes: string;
  /** null = ASAP */
  pickupAtMs: number | null;
}

export type ParseResult =
  | { ok: true; order: ParsedOrder }
  | { ok: false; error: string };

const KEY_ALIASES: Record<string, string> = {
  to: "address",
  address: "address",
  addr: "address",
  name: "name",
  customer: "name",
  phone: "phone",
  hp: "phone",
  mobile: "phone",
  time: "time",
  at: "time",
  vehicle: "vehicle",
  notes: "notes",
  remarks: "notes",
};

const SGT_OFFSET_MS = 8 * 3_600_000;

export function parseOrderMessage(text: string, nowMs: number): ParseResult {
  const fields: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Za-z]+)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    const key = KEY_ALIASES[m[1].toLowerCase()];
    if (key && !(key in fields)) fields[key] = m[2];
  }

  const missing = ["address", "name", "phone"].filter((k) => !fields[k]);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing ${missing.join(" and ")} — send the order like the pinned example.`,
    };
  }

  const phone = normalizePhone(fields.phone);
  if (!phone) {
    return {
      ok: false,
      error: `"${fields.phone}" doesn't look like a Singapore phone number (8 digits, mobile starts with 8 or 9).`,
    };
  }

  let vehicle: Vehicle = "CAR";
  if (fields.vehicle) {
    const v = fields.vehicle.trim().toUpperCase();
    if (v !== "CAR" && v !== "MPV" && v !== "VAN") {
      return { ok: false, error: `Unknown vehicle "${fields.vehicle}" — use car, mpv, or van.` };
    }
    vehicle = v;
  }

  let pickupAtMs: number | null = null;
  if (fields.time) {
    const parsed = parseTimeTodaySgt(fields.time, nowMs);
    if (parsed === null) {
      return {
        ok: false,
        error: `Couldn't understand the time "${fields.time}" — use forms like 3pm, 3:30pm, or 15:30, or leave time out for ASAP.`,
      };
    }
    if (parsed <= nowMs) {
      return {
        ok: false,
        error: `The time "${fields.time}" is already past — leave time out to book ASAP.`,
      };
    }
    pickupAtMs = parsed;
  }

  return {
    ok: true,
    order: {
      addressQuery: fields.address,
      name: fields.name,
      phone,
      vehicle,
      notes: fields.notes ?? "",
      pickupAtMs,
    },
  };
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  const m = digits.match(/^(?:\+65)?([3689]\d{7})$/);
  return m ? `+65${m[1]}` : null;
}

/** Parse "3pm" / "3:30pm" / "15:30" as a time today in Singapore time. */
function parseTimeTodaySgt(raw: string, nowMs: number): number | null {
  const m = raw
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;

  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3];

  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }

  const sgtNow = new Date(nowMs + SGT_OFFSET_MS);
  const midnightSgtMs =
    Date.UTC(sgtNow.getUTCFullYear(), sgtNow.getUTCMonth(), sgtNow.getUTCDate()) - SGT_OFFSET_MS;
  return midnightSgtMs + (hour * 60 + minute) * 60_000;
}
