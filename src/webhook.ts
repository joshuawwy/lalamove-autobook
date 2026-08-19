// Lalamove webhook receiver: filter the event stream down to the four
// notifications the Operator cares about, dedup Lalamove's re-fires, and
// stop tracking orders that reach a terminal status.

import type { Env } from "./env";
import { removeActiveOrder } from "./state";
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
        await sendPhoto(
          env,
          photos[0],
          `📸 <b>Pickup Photo</b>\n\n<b>Order:</b> <code>${orderId}</code>\n` +
            `<b>From:</b> ${escapeHtml(stop.name ?? "")}\n` +
            `<b>Address:</b> ${escapeHtml(stop.address ?? "")}`,
        );
        break;
      }
    }
    return;
  }

  if (decision.flushDedup && orderId) {
    await Promise.all(
      REASSIGNMENT_FLUSH_STATUSES.map((s) => env.STATE.delete(`webhook:${orderId}:${s}`)),
    );
  }

  // Lalamove re-fires stale events; dedup per order+status for 24h.
  const dedupStatus = status || eventType;
  if (orderId) {
    const key = `webhook:${orderId}:${dedupStatus}`;
    if (await env.STATE.get(key)) return;
    await env.STATE.put(key, "1", { expirationTtl: 86400 });
  }

  await sendMessage(env, formatNotification(payload, eventType, status, previousStatus, orderId));
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
