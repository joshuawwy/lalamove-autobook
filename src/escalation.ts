// Pure priority-fee ramp logic. Fees are TOTALS, not increments: Lalamove's
// priority-fee endpoint replaces the previous amount and each new amount must
// exceed it, so callers send the returned value as-is.

export type Vehicle = "CAR" | "MPV" | "VAN";

export interface EscalationConfig {
  asapWaitMin: number;
  asapStepFee: number;
  asapIntervalMin: number;
  orderFeeCap: number;
  /** Minutes between bumps within the scheduled gentle/aggressive tiers. */
  scheduledIntervalMin: number;
  gentleStartMin: number;
  gentleEndMin: number;
  gentleFee: number;
  aggressiveStartMin: number;
  aggressiveFee: number;
  aggressiveFeeVan: number;
}

export interface OrderForEscalation {
  mode: "asap" | "scheduled";
  bookedAtMs: number;
  pickupAtMs?: number;
  vehicle: Vehicle;
  currentFee: number;
}

const MS_PER_MIN = 60_000;

/** Round to cents to keep half-dollar tiers exact. */
function toCentsExact(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Returns the fee total the order should be at right now, or null when no
 * raise is due (too early, no change since last bump, cap already paid, or
 * the scheduled ramp's give-up point is past).
 */
export function computeTargetFee(
  order: OrderForEscalation,
  nowMs: number,
  cfg: EscalationConfig,
): number | null {
  const target =
    order.mode === "asap" ? asapTarget(order, nowMs, cfg) : scheduledTarget(order, nowMs, cfg);
  if (target === null) return null;
  const capped = toCentsExact(Math.min(target, cfg.orderFeeCap));
  return capped > order.currentFee ? capped : null;
}

function asapTarget(
  order: OrderForEscalation,
  nowMs: number,
  cfg: EscalationConfig,
): number | null {
  const minutesSinceBooked = (nowMs - order.bookedAtMs) / MS_PER_MIN;
  if (minutesSinceBooked < cfg.asapWaitMin) return null;
  const steps = Math.floor((minutesSinceBooked - cfg.asapWaitMin) / cfg.asapIntervalMin) + 1;
  return steps * cfg.asapStepFee;
}

function scheduledTarget(
  order: OrderForEscalation,
  nowMs: number,
  cfg: EscalationConfig,
): number | null {
  if (order.pickupAtMs === undefined) return null;

  // Late booking (booked after the intended pickup): shift the anchor forward
  // so the ramp starts fresh from when the order was actually placed instead
  // of applying the fully-accumulated fee immediately.
  let pickupMs = order.pickupAtMs;
  if (order.bookedAtMs > pickupMs) {
    pickupMs = order.bookedAtMs + cfg.gentleStartMin * MS_PER_MIN;
  }

  const minutesUntilPickup = (pickupMs - nowMs) / MS_PER_MIN;
  if (minutesUntilPickup > cfg.gentleStartMin) return null;
  if (minutesUntilPickup < -30) return null;

  const gentleSpanIntervals =
    Math.floor((cfg.gentleStartMin - cfg.gentleEndMin) / cfg.scheduledIntervalMin) + 1;
  const minutesIntoGentle =
    cfg.gentleStartMin - Math.max(minutesUntilPickup, cfg.gentleEndMin);
  const gentleIntervals = Math.min(
    Math.floor(minutesIntoGentle / cfg.scheduledIntervalMin) + 1,
    gentleSpanIntervals,
  );
  let fee = gentleIntervals * cfg.gentleFee;

  if (minutesUntilPickup <= cfg.aggressiveStartMin) {
    const aggressiveIntervals =
      Math.floor((cfg.aggressiveStartMin - minutesUntilPickup) / cfg.scheduledIntervalMin) + 1;
    const perInterval = order.vehicle === "VAN" ? cfg.aggressiveFeeVan : cfg.aggressiveFee;
    fee += aggressiveIntervals * perInterval;
  }

  return fee;
}
