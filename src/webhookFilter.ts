// Pure decisions for Lalamove webhooks: which of the ~7-8 webhooks per
// booking actually notify the Operator. Dedup storage and Telegram sends
// live in the handler; this module only decides.

export type WebhookDecision =
  | { kind: "skip" }
  | { kind: "photo" }
  | { kind: "replaced" }
  | { kind: "notify"; flushDedup: boolean };

export function decideWebhookAction(
  eventType: string,
  status: string,
  previousStatus: string,
): WebhookDecision {
  if (
    eventType === "WALLET_BALANCE_CHANGED" ||
    eventType === "POD_STATUS_CHANGED" ||
    // Fires on every priority-fee change; the monitor already notifies bumps.
    eventType === "ORDER_AMOUNT_CHANGED"
  ) {
    return { kind: "skip" };
  }
  if (eventType === "POP_STATUS_CHANGED") {
    return { kind: "photo" };
  }
  if (eventType === "ORDER_REPLACED") {
    // Lalamove cancel-and-cloned the order (e.g. waiting fees added): the
    // handler must re-key tracking from data.prevOrderId to the new orderId.
    return { kind: "replaced" };
  }
  if (status === "ASSIGNING_DRIVER" && !previousStatus) {
    return { kind: "skip" }; // initial state right after booking; not useful
  }
  if (status === "ASSIGNING_DRIVER" && previousStatus) {
    // Driver cancelled -> reassignment: flush dedup so the replacement
    // driver's lifecycle notifies fresh.
    return { kind: "notify", flushDedup: true };
  }
  if (status === "ON_GOING" && previousStatus === "ASSIGNING_DRIVER") {
    return { kind: "skip" }; // DRIVER_ASSIGNED fires alongside with driver details
  }
  return { kind: "notify", flushDedup: false };
}

const TERMINAL_STATUSES = new Set(["COMPLETED", "CANCELED", "REJECTED", "EXPIRED"]);

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Dedup-key statuses to flush when an order goes back to driver search. */
export const REASSIGNMENT_FLUSH_STATUSES = [
  "ASSIGNING_DRIVER",
  "DRIVER_ASSIGNED",
  "ON_GOING",
  "PICKED_UP",
] as const;
