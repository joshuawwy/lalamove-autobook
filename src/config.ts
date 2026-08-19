import type { EscalationConfig } from "./escalation";
import type { BasePlace } from "./lalamove";
import type { Env } from "./env";

function num(value: string | undefined, fallback: number): number {
  const n = parseFloat(value ?? "");
  return Number.isFinite(n) ? n : fallback;
}

export function escalationConfig(env: Env): EscalationConfig {
  return {
    asapWaitMin: num(env.ASAP_WAIT_MIN, 5),
    asapStepFee: num(env.ASAP_STEP_FEE, 1),
    asapIntervalMin: num(env.ASAP_INTERVAL_MIN, 5),
    orderFeeCap: num(env.ORDER_FEE_CAP, 5),
    gentleStartMin: num(env.GENTLE_START_MIN, 30),
    gentleEndMin: num(env.GENTLE_END_MIN, 15),
    gentleFee: num(env.GENTLE_FEE, 0.5),
    aggressiveStartMin: num(env.AGGRESSIVE_START_MIN, 10),
    aggressiveFee: num(env.AGGRESSIVE_FEE, 2),
    aggressiveFeeVan: num(env.AGGRESSIVE_FEE_VAN, 4),
  };
}

export function basePlace(env: Env): BasePlace {
  return {
    name: env.BASE_NAME,
    phone: env.BASE_PHONE,
    address: env.BASE_ADDRESS,
    lat: num(env.BASE_LAT, 0),
    lng: num(env.BASE_LNG, 0),
  };
}

const SGT_OFFSET_MS = 8 * 3_600_000;

/** "3:15 PM" in Singapore time, for messages. */
export function formatSgtTime(ms: number): string {
  const d = new Date(ms + SGT_OFFSET_MS);
  const h24 = d.getUTCHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  return `${h12}:${mm} ${h24 < 12 ? "AM" : "PM"}`;
}
