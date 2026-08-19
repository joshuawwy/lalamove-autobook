import { describe, expect, it } from "vitest";
import { decideWebhookAction, isTerminalStatus } from "../src/webhookFilter";

// Expected behavior is the TouristPads webhook lifecycle table: ~7-8 webhooks
// per booking filtered down to driver-assigned, picked-up, pickup photo, and
// completed, with reassignments flushing dedup so the new driver's lifecycle
// notifies fresh.
describe("decideWebhookAction", () => {
  it("skips wallet and POD events (POD repeats POP data, no delivery photos)", () => {
    expect(decideWebhookAction("WALLET_BALANCE_CHANGED", "", "").kind).toBe("skip");
    expect(decideWebhookAction("POD_STATUS_CHANGED", "PICKED_UP", "").kind).toBe("skip");
  });

  it("skips ORDER_AMOUNT_CHANGED (the monitor already notifies fee bumps)", () => {
    expect(decideWebhookAction("ORDER_AMOUNT_CHANGED", "", "").kind).toBe("skip");
  });

  it("routes ORDER_REPLACED to the re-keying handler", () => {
    expect(decideWebhookAction("ORDER_REPLACED", "", "").kind).toBe("replaced");
  });

  it("sends the pickup photo for POP events", () => {
    expect(decideWebhookAction("POP_STATUS_CHANGED", "PICKED_UP", "").kind).toBe("photo");
  });

  it("skips the initial ASSIGNING_DRIVER (no previous status)", () => {
    expect(decideWebhookAction("ORDER_STATUS_CHANGED", "ASSIGNING_DRIVER", "").kind).toBe("skip");
  });

  it("notifies + flushes dedup when a driver bails (reassignment)", () => {
    const d = decideWebhookAction("ORDER_STATUS_CHANGED", "ASSIGNING_DRIVER", "ON_GOING");
    expect(d).toEqual({ kind: "notify", flushDedup: true });
  });

  it("skips ON_GOING from ASSIGNING_DRIVER (DRIVER_ASSIGNED carries more info)", () => {
    expect(decideWebhookAction("ORDER_STATUS_CHANGED", "ON_GOING", "ASSIGNING_DRIVER").kind).toBe(
      "skip",
    );
  });

  it("notifies DRIVER_ASSIGNED, PICKED_UP, and COMPLETED", () => {
    expect(decideWebhookAction("DRIVER_ASSIGNED", "", "")).toEqual({
      kind: "notify",
      flushDedup: false,
    });
    expect(decideWebhookAction("ORDER_STATUS_CHANGED", "PICKED_UP", "ON_GOING").kind).toBe(
      "notify",
    );
    expect(decideWebhookAction("ORDER_STATUS_CHANGED", "COMPLETED", "PICKED_UP").kind).toBe(
      "notify",
    );
  });
});

describe("isTerminalStatus", () => {
  it("marks lifecycle-ending statuses so the monitor stops tracking the order", () => {
    for (const s of ["COMPLETED", "CANCELED", "REJECTED", "EXPIRED"]) {
      expect(isTerminalStatus(s)).toBe(true);
    }
    for (const s of ["ASSIGNING_DRIVER", "ON_GOING", "PICKED_UP"]) {
      expect(isTerminalStatus(s)).toBe(false);
    }
  });
});
