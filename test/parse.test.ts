import { describe, expect, it } from "vitest";
import { parseOrderMessage } from "../src/parse";

// SGT is UTC+8 year-round. "Today" for time parsing.
const NOW = Date.parse("2026-08-19T02:00:00Z"); // 10:00 SGT

describe("parseOrderMessage", () => {
  it("parses the pinned-example shape", () => {
    const r = parseOrderMessage(
      "to: 313 Orchard Rd\nname: Sarah Tan\nphone: 91234567\nnotes: fragile cake",
      NOW,
    );
    expect(r).toEqual({
      ok: true,
      order: {
        addressQuery: "313 Orchard Rd",
        name: "Sarah Tan",
        phone: "+6591234567",
        vehicle: "CAR",
        notes: "fragile cake",
        pickupAtMs: null,
      },
    });
  });

  it("accepts key aliases and mixed case", () => {
    const r = parseOrderMessage("Address: 238895\nName: Ben\nHP: 81234567", NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.order.addressQuery).toBe("238895");
      expect(r.order.phone).toBe("+6581234567");
    }
  });

  it("keeps an already-prefixed phone and strips spaces", () => {
    const r = parseOrderMessage("to: 238895\nname: Ben\nphone: +65 9123 4567", NOW);
    expect(r.ok && r.order.phone).toBe("+6591234567");
  });

  it("rejects a phone that is not a Singapore mobile", () => {
    const r = parseOrderMessage("to: 238895\nname: Ben\nphone: 12345", NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/phone/i);
  });

  it("says which fields are missing", () => {
    const r = parseOrderMessage("to: 238895", NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/name/i);
      expect(r.error).toMatch(/phone/i);
    }
  });

  it("parses vehicle keywords", () => {
    const r = parseOrderMessage("to: 238895\nname: Ben\nphone: 91234567\nvehicle: van", NOW);
    expect(r.ok && r.order.vehicle).toBe("VAN");
  });

  it("parses a 12-hour time as today SGT", () => {
    const r = parseOrderMessage("to: 238895\nname: Ben\nphone: 91234567\ntime: 3pm", NOW);
    // 15:00 SGT = 07:00 UTC same day
    expect(r.ok && r.order.pickupAtMs).toBe(Date.parse("2026-08-19T07:00:00Z"));
  });

  it("parses minutes and 24-hour forms", () => {
    const a = parseOrderMessage("to: 238895\nname: Ben\nphone: 91234567\ntime: 3:30pm", NOW);
    expect(a.ok && a.order.pickupAtMs).toBe(Date.parse("2026-08-19T07:30:00Z"));
    const b = parseOrderMessage("to: 238895\nname: Ben\nphone: 91234567\ntime: 15:30", NOW);
    expect(b.ok && b.order.pickupAtMs).toBe(Date.parse("2026-08-19T07:30:00Z"));
  });

  it("rejects a time already past", () => {
    const r = parseOrderMessage("to: 238895\nname: Ben\nphone: 91234567\ntime: 9am", NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/past/i);
  });

  it("rejects an unparseable time rather than silently going ASAP", () => {
    const r = parseOrderMessage("to: 238895\nname: Ben\nphone: 91234567\ntime: soonish", NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/time/i);
  });

  it("ignores blank lines and non key:value chatter around the fields", () => {
    const r = parseOrderMessage(
      "hi!\n\nto: 313 Orchard Rd\nname: Sarah\nphone: 91234567\n\nthanks",
      NOW,
    );
    expect(r.ok).toBe(true);
  });
});
