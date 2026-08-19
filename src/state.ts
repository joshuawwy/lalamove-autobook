// KV-backed state. Single-operator system, so the read-modify-write on the
// active list is uncontended in practice (one bot chat, one cron).

import type { Vehicle } from "./escalation";
import type { GeocodeCandidate } from "./onemap";
import type { ParsedOrder } from "./parse";

export interface OrderRecord {
  orderId: string;
  mode: "asap" | "scheduled";
  bookedAtMs: number;
  pickupAtMs?: number;
  vehicle: Vehicle;
  currentFee: number;
  capAlerted: boolean;
  shareLink: string;
  customerName: string;
  dropoffAddress: string;
}

export interface Draft {
  order: ParsedOrder;
  candidates: GeocodeCandidate[];
  /** Set once an address candidate is chosen and quoted. */
  quote?: {
    quotationId: string;
    stopIds: [string, string];
    price: string;
    currency: string;
    dropoff: GeocodeCandidate;
  };
  awaitingLocation?: boolean;
}

const ACTIVE_KEY = "active";
const ORDER_TTL = 48 * 3600;
const DRAFT_TTL = 30 * 60;

export async function getActiveOrderIds(kv: KVNamespace): Promise<string[]> {
  const raw = await kv.get(ACTIVE_KEY);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

async function putActiveOrderIds(kv: KVNamespace, ids: string[]): Promise<void> {
  await kv.put(ACTIVE_KEY, JSON.stringify(ids));
}

export async function addActiveOrder(kv: KVNamespace, record: OrderRecord): Promise<void> {
  await kv.put(`order:${record.orderId}`, JSON.stringify(record), { expirationTtl: ORDER_TTL });
  const ids = await getActiveOrderIds(kv);
  if (!ids.includes(record.orderId)) {
    await putActiveOrderIds(kv, [...ids, record.orderId]);
  }
}

export async function getOrder(kv: KVNamespace, orderId: string): Promise<OrderRecord | null> {
  const raw = await kv.get(`order:${orderId}`);
  return raw ? (JSON.parse(raw) as OrderRecord) : null;
}

export async function updateOrder(kv: KVNamespace, record: OrderRecord): Promise<void> {
  await kv.put(`order:${record.orderId}`, JSON.stringify(record), { expirationTtl: ORDER_TTL });
}

export async function removeActiveOrder(kv: KVNamespace, orderId: string): Promise<void> {
  const ids = await getActiveOrderIds(kv);
  await putActiveOrderIds(kv, ids.filter((id) => id !== orderId));
}

// One draft at a time per chat — the Operator books one order per conversation turn.
export async function putDraft(kv: KVNamespace, chatId: string, draft: Draft): Promise<void> {
  await kv.put(`draft:${chatId}`, JSON.stringify(draft), { expirationTtl: DRAFT_TTL });
}

export async function getDraft(kv: KVNamespace, chatId: string): Promise<Draft | null> {
  const raw = await kv.get(`draft:${chatId}`);
  return raw ? (JSON.parse(raw) as Draft) : null;
}

export async function deleteDraft(kv: KVNamespace, chatId: string): Promise<void> {
  await kv.delete(`draft:${chatId}`);
}
