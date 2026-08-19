// KV-backed state. Active orders are the `order:` keys themselves (listed by
// prefix) rather than a separate index value: the bot, the Lalamove webhook,
// and the cron all add/remove orders concurrently, and a single index key
// maintained by read-modify-write would lose updates (KV has no CAS).

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
  /** Random nonce carried in the card's callback data, so buttons on a
   * superseded card can't act on a newer draft. */
  id: string;
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

const ORDER_PREFIX = "order:";
const ORDER_TTL = 48 * 3600;
const DRAFT_TTL = 30 * 60;

export async function getActiveOrderIds(kv: KVNamespace): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const res = await kv.list({ prefix: ORDER_PREFIX, cursor });
    for (const key of res.keys) ids.push(key.name.slice(ORDER_PREFIX.length));
    if (res.list_complete) return ids;
    cursor = res.cursor;
  }
}

export async function addActiveOrder(kv: KVNamespace, record: OrderRecord): Promise<void> {
  await kv.put(`${ORDER_PREFIX}${record.orderId}`, JSON.stringify(record), {
    expirationTtl: ORDER_TTL,
  });
}

export async function getOrder(kv: KVNamespace, orderId: string): Promise<OrderRecord | null> {
  const raw = await kv.get(`${ORDER_PREFIX}${orderId}`);
  return raw ? (JSON.parse(raw) as OrderRecord) : null;
}

export async function updateOrder(kv: KVNamespace, record: OrderRecord): Promise<void> {
  await addActiveOrder(kv, record);
}

export async function removeActiveOrder(kv: KVNamespace, orderId: string): Promise<void> {
  await kv.delete(`${ORDER_PREFIX}${orderId}`);
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
