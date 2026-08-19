// Lalamove webhook receiver: filter the event stream down to the four
// notifications the Operator cares about, dedup Lalamove's re-fires, and
// stop tracking orders that reach a terminal status.

import type { Env } from "./env";
import { addActiveOrder, getOrder, removeActiveOrder } from "./state";
import { escapeHtml, sendMessage, sendPhoto } from "./telegram";
import {
  decideWebhookAction,
  isTerminalStatus,
  REASSIGNMENT_FLUSH_STATUSES,
} from "./webhookFilter";

const STATUS_TEXT: Record<string, string> = {
  ASSIGNING_DRIVER: "Finding New Driver",
  ON_GOING: "Driver On The Way",
  PICKED_UP: "Order Picked Up",
  COMPLETED: "Order Completed",
  CANCELED: "Order Cancelled",
  REJECTED: "Order Rejected",
  EXPIRED: "Order Expired",
  DRIVER_ASSIGNED: "Driver Assigned",
};

const STATUS_EMOJI: Record<string, string> = {
  ASSIGNING_DRIVER: "🔍",
  ON_GOING: "🚗",
  PICKED_UP: "📦",
  COMPLETED: "✅",
  CANCELED: "❌",
  REJECTED: "⚠️",
  EXPIRED: "⏰",
  DRIVER_ASSIGNED: "🚗",
};

export async function handleLalamoveWebhook(env: Env, payload: any): Promise<void> {
  const eventType: string = payload.eventType ?? "";
  const order = payload.data?.order ?? {};
  const status: string = order.status ?? payload.status ?? "";
  const previousStatus: string = order.previousStatus ?? "";
  const orderId: string = order.orderId ?? payload.orderId ?? "";

  const decision = decideWebhookAction(eventType, status, previousStatus);

  if (isTerminalStatus(status) && orderId) {
    await removeActiveOrder(env.STATE, orderId);
  }

  if (decision.kind === "skip") return;

  if (decision.kind === "photo") {
    const stops: any[] = order.stops ?? [];
    for (const stop of stops) {
      const photos: string[] = stop.POP?.imageUrls ?? [];
      if (photos.length > 0) {
        // Dedup re-fires, but only once a photo actually exists (the first POP
        // event can be a PENDING one without images) and the send succeeded.
        const key = `webhook:${orderId}:POP`;
        if (orderId && (await env.STATE.get(key))) return;
        const sent = await sendPhoto(
          env,
          photos[0],
          `📸 <b>Pickup Photo</b>\n\n<b>Order:</b> <code>${orderId}</code>\n` +
            `<b>From:</b> ${escapeHtml(stop.name ?? "")}\n` +
            `<b>Address:</b> ${escapeHtml(stop.address ?? "")}`,
        );
        if (orderId && sent?.ok) await env.STATE.put(key, "1", { expirationTtl: 86400 });
        break;
      }
    }
    return;
  }

  if (decision.kind === "replaced") {
    await handleOrderReplaced(env, payload, orderId);
    return;
  }

  if (decision.flushDedup && orderId) {
    await Promise.all(
      REASSIGNMENT_FLUSH_STATUSES.map((s) => env.STATE.delete(`webhook:${orderId}:${s}`)),
    );
  }

  // Lalamove re-fires stale events; dedup per order+status for 24h. The
  // marker is written only after Telegram accepts the message, so a failed
  // send (e.g. 429) can still be delivered by the next re-fire.
  const dedupKey = orderId ? `webhook:${orderId}:${status || eventType}` : null;
  if (dedupKey && (await env.STATE.get(dedupKey))) return;

  const sent = await sendMessage(
    env,
    formatNotification(payload, eventType, status, previousStatus, orderId),
  );
  if (dedupKey && sent?.ok) await env.STATE.put(dedupKey, "1", { expirationTtl: 86400 });
}

/** Lalamove cancel-and-cloned the order: carry tracking over to the new id. */
async function handleOrderReplaced(env: Env, payload: any, newOrderId: string): Promise<void> {
  const prevOrderId: string = payload.data?.prevOrderId ?? "";
  if (!newOrderId || !prevOrderId) return;

  const key = `webhook:${newOrderId}:REPLACED`;
  if (await env.STATE.get(key)) return;

  const record = await getOrder(env.STATE, prevOrderId);
  if (record) {
    await addActiveOrder(env.STATE, { ...record, orderId: newOrderId });
    await removeActiveOrder(env.STATE, prevOrderId);
  }

  const sent = await sendMessage(
    env,
    `🔁 <b>Order Replaced by Lalamove</b>\n\n` +
      `<code>${prevOrderId}</code> → <code>${newOrderId}</code>\n` +
      (record
        ? `Tracking carried over (${escapeHtml(record.customerName)}).`
        : `The original order was no longer tracked — check /status.`),
  );
  if (sent?.ok) await env.STATE.put(key, "1", { expirationTtl: 86400 });
}

function formatNotification(
  payload: any,
  eventType: string,
  status: string,
  previousStatus: string,
  orderId: string,
): string {
  const displayKey = status || eventType;
  const emoji = STATUS_EMOJI[displayKey] ?? "📋";
  const text = STATUS_TEXT[displayKey] ?? displayKey;

  let message = `${emoji} <b>${text}</b>\n\n<b>Order:</b> <code>${orderId || "Unknown"}</code>\n`;
  if (previousStatus && previousStatus !== status) {
    message += `<b>Previous:</b> ${STATUS_TEXT[previousStatus] ?? previousStatus}\n`;
  }
  const shareLink = payload.data?.order?.shareLink;
  if (shareLink) message += `\n<a href="${shareLink}">📍 Track</a>\n`;

  // DRIVER_ASSIGNED payloads carry the driver at data.driver.
  const driver = payload.data?.driver ?? payload.driver;
  if (driver) {
    message += `\n<b>Driver:</b> ${escapeHtml(driver.name ?? "N/A")}\n`;
    if (driver.phone) message += `<b>Phone:</b> ${escapeHtml(driver.phone)}\n`;
    if (driver.plateNumber) message += `<b>Vehicle:</b> ${escapeHtml(driver.plateNumber)}\n`;
  }
  return message;
}
