// Cron-driven escalation: every minute, walk active orders still waiting for
// a driver and raise their priority fee along the preset ramp.

import { escalationConfig } from "./config";
import { computeTargetFee } from "./escalation";
import type { Env } from "./env";
import { LalamoveClient, LalamoveError } from "./lalamove";
import { getActiveOrderIds, getOrder, removeActiveOrder, updateOrder } from "./state";
import { escapeHtml, sendMessage } from "./telegram";
import { isTerminalStatus } from "./webhookFilter";

export async function runMonitor(env: Env): Promise<void> {
  const ids = await getActiveOrderIds(env.STATE);
  if (ids.length === 0) return;

  const cfg = escalationConfig(env);
  const lalamove = new LalamoveClient(env);
  const now = Date.now();

  for (const orderId of ids) {
    try {
      const record = await getOrder(env.STATE, orderId);
      if (!record) {
        await removeActiveOrder(env.STATE, orderId);
        continue;
      }

      const status = await lalamove.getOrderStatus(orderId);
      if (isTerminalStatus(status)) {
        // The webhook already notified the status change; just stop tracking.
        await removeActiveOrder(env.STATE, orderId);
        continue;
      }
      if (status !== "ASSIGNING_DRIVER") continue;

      const target = computeTargetFee(
        {
          mode: record.mode,
          bookedAtMs: record.bookedAtMs,
          ...(record.pickupAtMs !== undefined ? { pickupAtMs: record.pickupAtMs } : {}),
          vehicle: record.vehicle,
          currentFee: record.currentFee,
        },
        now,
        cfg,
      );

      if (target === null) {
        if (record.currentFee >= cfg.orderFeeCap && !record.capAlerted) {
          await updateOrder(env.STATE, { ...record, capAlerted: true });
          await sendMessage(
            env,
            `⏳ <b>Still no driver</b>\n\n` +
              `<code>${orderId}</code> (${escapeHtml(record.customerName)}) is at the ` +
              `$${cfg.orderFeeCap.toFixed(2)} fee cap.\n\n` +
              `Reply <code>/bump 2 ${orderId}</code> to push higher, or ` +
              `<code>/cancel ${orderId}</code> to give up.`,
          );
        }
        continue;
      }

      try {
        await lalamove.addPriorityFee(orderId, target.toFixed(2));
        await updateOrder(env.STATE, { ...record, currentFee: target });
        await sendMessage(
          env,
          `💰 <b>Priority Fee Added</b>\n\n` +
            `<b>Order:</b> <code>${orderId}</code>\n` +
            `<b>Vehicle:</b> ${record.vehicle}\n` +
            `<b>Fee:</b> $${record.currentFee.toFixed(2)} → $${target.toFixed(2)}`,
        );
      } catch (e) {
        const detail = e instanceof LalamoveError ? e.message : String(e);
        await sendMessage(
          env,
          `⚠️ <b>Priority Fee Not Added</b>\n\n` +
            `<b>Order:</b> <code>${orderId}</code>\n` +
            `<b>Attempted:</b> $${target.toFixed(2)}\n` +
            `<b>Lalamove:</b> ${escapeHtml(detail)}`,
        );
      }
    } catch (e) {
      console.error(`Monitor error for order ${orderId}:`, e);
    }
  }
}
