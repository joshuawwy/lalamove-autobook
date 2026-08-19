import { describe, expect, it } from "vitest";
import {
  computeTargetFee,
  type EscalationConfig,
  type OrderForEscalation,
} from "../src/escalation";

const cfg: EscalationConfig = {
  asapWaitMin: 5,
  asapStepFee: 1,
  asapIntervalMin: 5,
  orderFeeCap: 5,
  gentleStartMin: 30,
  gentleEndMin: 15,
  gentleFee: 0.5,
  aggressiveStartMin: 10,
  aggressiveFee: 2,
  aggressiveFeeVan: 4,
};

const T0 = Date.parse("2026-08-19T04:00:00Z");
const min = (n: number) => n * 60_000;

function asapOrder(overrides: Partial<OrderForEscalation> = {}): OrderForEscalation {
  return { mode: "asap", bookedAtMs: T0, vehicle: "CAR", currentFee: 0, ...overrides };
}

function scheduledOrder(
  pickupOffsetMin: number,
  overrides: Partial<OrderForEscalation> = {},
): OrderForEscalation {
  return {
    mode: "scheduled",
    bookedAtMs: T0 - min(120),
    pickupAtMs: T0 + min(pickupOffsetMin),
    vehicle: "CAR",
    currentFee: 0,
    ...overrides,
  };
}

describe("ASAP ramp (anchored to booking time)", () => {
  it("waits for an organic match before the first bump", () => {
    expect(computeTargetFee(asapOrder(), T0 + min(3), cfg)).toBeNull();
  });

  it("bumps to the first step once the wait elapses", () => {
    expect(computeTargetFee(asapOrder(), T0 + min(5), cfg)).toBe(1);
  });

  it("does not re-raise within the same interval", () => {
    expect(computeTargetFee(asapOrder({ currentFee: 1 }), T0 + min(9), cfg)).toBeNull();
  });

  it("steps to the next total each interval", () => {
    expect(computeTargetFee(asapOrder({ currentFee: 1 }), T0 + min(10), cfg)).toBe(2);
    expect(computeTargetFee(asapOrder({ currentFee: 3 }), T0 + min(20), cfg)).toBe(4);
  });

  it("never exceeds the per-order cap", () => {
    expect(computeTargetFee(asapOrder({ currentFee: 4 }), T0 + min(60), cfg)).toBe(5);
  });

  it("goes quiet once the cap is already paid", () => {
    expect(computeTargetFee(asapOrder({ currentFee: 5 }), T0 + min(60), cfg)).toBeNull();
  });
});

describe("Scheduled ramp (anchored to pickup time, TouristPads tiers)", () => {
  // Expected values worked by hand from the tier spec:
  // gentle $0.50/interval from 30 to 15 min before pickup (max 4 intervals),
  // aggressive $2 (car/MPV) or $4 (van) per interval from 10 min before,
  // silent before 30 min out and after 30 min past pickup.
  const uncapped = { ...cfg, orderFeeCap: 100 };

  it("is silent more than 30 min before pickup", () => {
    expect(computeTargetFee(scheduledOrder(35), T0, uncapped)).toBeNull();
  });

  it("starts gentle: one interval at 28 min out", () => {
    expect(computeTargetFee(scheduledOrder(28), T0, uncapped)).toBe(0.5);
  });

  it("gentle grows: two intervals at 22 min out", () => {
    expect(computeTargetFee(scheduledOrder(22), T0, uncapped)).toBe(1);
  });

  it("gentle tops out at four intervals ($2) and holds through the quiet gap", () => {
    expect(computeTargetFee(scheduledOrder(15), T0, uncapped)).toBe(2);
    expect(computeTargetFee(scheduledOrder(12, { currentFee: 2 }), T0, uncapped)).toBeNull();
  });

  it("aggressive kicks in at 10 min out on top of gentle", () => {
    expect(computeTargetFee(scheduledOrder(10, { currentFee: 2 }), T0, uncapped)).toBe(4);
  });

  it("aggressive keeps stepping past pickup", () => {
    expect(computeTargetFee(scheduledOrder(5, { currentFee: 4 }), T0, uncapped)).toBe(6);
    expect(computeTargetFee(scheduledOrder(-10, { currentFee: 6 }), T0, uncapped)).toBe(12);
  });

  it("vans escalate harder", () => {
    expect(computeTargetFee(scheduledOrder(10, { vehicle: "VAN" }), T0, uncapped)).toBe(6);
  });

  it("gives up 30 min after pickup", () => {
    expect(computeTargetFee(scheduledOrder(-31), T0, uncapped)).toBeNull();
  });

  it("respects the per-order cap", () => {
    expect(computeTargetFee(scheduledOrder(5, { currentFee: 4 }), T0, cfg)).toBe(5);
  });

  it("shifts the anchor for late bookings so the ramp starts fresh", () => {
    // Booked 20 min AFTER the calendar pickup time: anchor becomes
    // bookedAt + 30 min, so 10 min after booking the effective distance to
    // "pickup" is 20 min -> gentle tier, 3 intervals = $1.50.
    const late: OrderForEscalation = {
      mode: "scheduled",
      bookedAtMs: T0,
      pickupAtMs: T0 - min(20),
      vehicle: "CAR",
      currentFee: 0,
    };
    expect(computeTargetFee(late, T0 + min(10), uncapped)).toBe(1.5);
  });
});
