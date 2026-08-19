// Telegram bot: Order Messages in, confirmation cards out, plus the small
// command set (/status, /bump, /cancel). One draft per chat at a time.

import { basePlace, escalationConfig, formatSgtTime } from "./config";
import type { Env } from "./env";
import { buildQuotationPayload, LalamoveClient, LalamoveError } from "./lalamove";
import { geocode, type GeocodeCandidate } from "./onemap";
import { parseOrderMessage, type ParsedOrder } from "./parse";
import {
  addActiveOrder,
  deleteDraft,
  getActiveOrderIds,
  getDraft,
  getOrder,
  putDraft,
  removeActiveOrder,
  updateOrder,
  type Draft,
} from "./state";
import { answerCallback, buttonRows, clearButtons, escapeHtml, sendMessage } from "./telegram";

const USAGE = `<b>Book a delivery</b> — send a message like:

<code>to: 313 Orchard Rd
name: Sarah Tan
phone: 91234567</code>

Optional lines:
<code>time: 3pm</code> (leave out for ASAP)
<code>vehicle: van</code> (car, mpv, or van — default car)
<code>notes: fragile cake</code>

You can also send a location pin if I can't find the address.

<b>Commands</b>
/status — active orders and their priority fees
/bump 2 — add $2 on top of an order's current priority fee
/cancel — cancel an active order
/help — this message`;

export async function handleTelegramUpdate(env: Env, update: any): Promise<void> {
  if (update.callback_query) {
    await handleCallback(env, update.callback_query);
    return;
  }

  const message = update.message;
  if (!message?.chat?.id) return;
  const chatId = String(message.chat.id);

  if (chatId !== env.TELEGRAM_CHAT_ID) {
    await sendMessage(env, `This bot is private. (Your chat id is <code>${chatId}</code>.)`, {
      chatId,
    });
    return;
  }

  if (message.location) {
    await handleLocation(env, chatId, message.location);
    return;
  }

  const text: string = message.text ?? "";
  if (!text.trim()) return;

  if (text.startsWith("/")) {
    await handleCommand(env, chatId, text.trim());
    return;
  }

  await startDraft(env, chatId, text);
}

async function startDraft(env: Env, chatId: string, text: string): Promise<void> {
  const parsed = parseOrderMessage(text, Date.now());
  if (!parsed.ok) {
    await sendMessage(env, `⚠️ ${escapeHtml(parsed.error)}\n\nSend /help for the format.`);
    return;
  }

  let candidates: GeocodeCandidate[];
  try {
    candidates = await geocode(env, parsed.order.addressQuery);
  } catch (e) {
    await sendMessage(env, `⚠️ Address lookup failed (${escapeHtml(String(e))}). Try again in a minute.`);
    return;
  }

  const draftId = crypto.randomUUID().slice(0, 8);

  if (candidates.length === 0) {
    await putDraft(env.STATE, chatId, {
      id: draftId,
      order: parsed.order,
      candidates: [],
      awaitingLocation: true,
    });
    await sendMessage(
      env,
      `⚠️ Couldn't find <b>${escapeHtml(parsed.order.addressQuery)}</b>.\n\n` +
        `Try the 6-digit postal code, or send a location pin 📍 and I'll use that.`,
    );
    return;
  }

  const draft: Draft = { id: draftId, order: parsed.order, candidates };
  if (candidates.length === 1) {
    await quoteAndSendCard(env, chatId, draft, candidates[0]);
    return;
  }

  await putDraft(env.STATE, chatId, draft);
  await sendMessage(env, "📍 Which address is it?", {
    keyboard: buttonRows(
      candidates.map((c, i) => [
        { text: `${c.label} — ${c.address}`.slice(0, 60), data: `addr:${i}:${draft.id}` },
      ]),
    ),
  });
}

async function handleLocation(
  env: Env,
  chatId: string,
  location: { latitude: number; longitude: number },
): Promise<void> {
  const draft = await getDraft(env.STATE, chatId);
  if (!draft?.awaitingLocation) {
    await sendMessage(env, "Send the order details first, then the pin if I can't find the address.");
    return;
  }
  const dropoff: GeocodeCandidate = {
    label: "Pinned location",
    address: draft.order.addressQuery,
    postal: "",
    lat: location.latitude,
    lng: location.longitude,
  };
  await quoteAndSendCard(env, chatId, { ...draft, awaitingLocation: false }, dropoff);
}

async function quoteAndSendCard(
  env: Env,
  chatId: string,
  draft: Draft,
  dropoff: GeocodeCandidate,
  notice = "",
): Promise<void> {
  const lalamove = new LalamoveClient(env);
  const payload = buildQuotationPayload(draft.order, basePlace(env), dropoff);

  let quote;
  try {
    quote = await lalamove.getQuotation(payload);
  } catch (e) {
    const detail = e instanceof LalamoveError ? e.message : String(e);
    await sendMessage(env, `❌ Couldn't get a quote: ${escapeHtml(detail)}`);
    return;
  }

  await putDraft(env.STATE, chatId, {
    ...draft,
    quote: { ...quote, dropoff },
  });

  const card = formatCard(draft.order, dropoff, `${quote.currency} ${quote.price}`);
  await sendMessage(env, (notice ? `${notice}\n\n` : "") + card, {
    keyboard: buttonRows([
      [
        { text: "✅ Book it", data: `book:${draft.id}` },
        { text: "❌ Discard", data: `discard:${draft.id}` },
      ],
    ]),
  });
}

function formatCard(order: ParsedOrder, dropoff: GeocodeCandidate, price: string): string {
  const when = order.pickupAtMs === null ? "ASAP" : formatSgtTime(order.pickupAtMs);
  return (
    `🧾 <b>Confirm booking</b>\n\n` +
    `<b>To:</b> ${escapeHtml(dropoff.address || dropoff.label)}\n` +
    `<b>Customer:</b> ${escapeHtml(order.name)} (${escapeHtml(order.phone)})\n` +
    `<b>Vehicle:</b> ${order.vehicle}\n` +
    `<b>Pickup:</b> ${when}\n` +
    (order.notes ? `<b>Notes:</b> ${escapeHtml(order.notes)}\n` : "") +
    `\n<b>Price: ${escapeHtml(price)}</b>`
  );
}

async function handleCallback(env: Env, cb: any): Promise<void> {
  const chatId = String(cb.message?.chat?.id ?? "");
  const messageId: number | undefined = cb.message?.message_id;
  const data: string = cb.data ?? "";

  if (chatId !== env.TELEGRAM_CHAT_ID) {
    await answerCallback(env, cb.id, "Not authorized.");
    return;
  }

  const draft = await getDraft(env.STATE, chatId);
  // Every button carries the draft nonce it was rendered for, so a button on
  // a superseded card can never act on a newer draft.
  const [action, ...rest] = data.split(":");
  const staleDraft = (draftId: string | undefined) => !draft || draft.id !== draftId;

  if (action === "addr") {
    await answerCallback(env, cb.id);
    if (messageId !== undefined) await clearButtons(env, chatId, messageId);
    const idx = parseInt(rest[0] ?? "", 10);
    const candidate = draft?.candidates[idx];
    if (staleDraft(rest[1]) || !candidate) {
      await sendMessage(env, "That card is no longer current — send the order again.");
      return;
    }
    await quoteAndSendCard(env, chatId, draft!, candidate);
    return;
  }

  if (action === "discard") {
    await answerCallback(env, cb.id, "Discarded.");
    if (messageId !== undefined) await clearButtons(env, chatId, messageId);
    if (staleDraft(rest[0])) {
      await sendMessage(env, "That card is no longer current.");
      return;
    }
    await deleteDraft(env.STATE, chatId);
    await sendMessage(env, "🗑 Draft discarded.");
    return;
  }

  if (action === "book") {
    await answerCallback(env, cb.id);
    if (messageId !== undefined) await clearButtons(env, chatId, messageId);
    if (staleDraft(rest[0]) || !draft?.quote) {
      await sendMessage(env, "That card is no longer current — send the order again.");
      return;
    }
    // Consume the draft BEFORE booking so a double-tap (Telegram processes
    // each callback concurrently) can't book the same quotation twice.
    await deleteDraft(env.STATE, chatId);
    await bookDraft(env, chatId, draft);
    return;
  }

  await answerCallback(env, cb.id);
}

async function bookDraft(env: Env, chatId: string, draft: Draft): Promise<void> {
  const lalamove = new LalamoveClient(env);
  const base = basePlace(env);
  const quote = draft.quote!;

  let result;
  try {
    result = await lalamove.createOrder(quote.quotationId, quote.stopIds, base, draft.order);
  } catch (e) {
    // Quotations expire after ~5 minutes: for that specific failure, requote
    // and put up a fresh card. Every other failure (402 empty wallet, 409
    // duplicate, 422 bad data, ...) must reach the Operator verbatim —
    // masking it as "quote expired" would loop them forever.
    const detail = e instanceof LalamoveError ? e.message : String(e);
    const quoteExpired =
      e instanceof LalamoveError && /quotation|expire/i.test(e.message);
    if (quoteExpired) {
      await quoteAndSendCard(
        env,
        chatId,
        draft,
        quote.dropoff,
        "⚠️ The quote had expired — here's a fresh one.",
      );
    } else {
      await sendMessage(
        env,
        `❌ Booking failed: ${escapeHtml(detail)}\n\n` +
          `No order was confirmed — send the order again once that's sorted.`,
      );
    }
    return;
  }

  await addActiveOrder(env.STATE, {
    orderId: result.orderId,
    mode: draft.order.pickupAtMs === null ? "asap" : "scheduled",
    bookedAtMs: Date.now(),
    ...(draft.order.pickupAtMs !== null ? { pickupAtMs: draft.order.pickupAtMs } : {}),
    vehicle: draft.order.vehicle,
    currentFee: 0,
    capAlerted: false,
    shareLink: result.shareLink,
    customerName: draft.order.name,
    dropoffAddress: quote.dropoff.address || quote.dropoff.label,
  });

  const when = draft.order.pickupAtMs === null ? "ASAP" : formatSgtTime(draft.order.pickupAtMs);
  await sendMessage(
    env,
    `✅ <b>Lalamove Booked</b>\n\n` +
      `<b>Order:</b> <code>${result.orderId}</code>\n` +
      `<b>To:</b> ${escapeHtml(quote.dropoff.address || quote.dropoff.label)}\n` +
      `<b>Pickup:</b> ${when}\n\n` +
      `<a href="${result.shareLink}">📍 Track</a>`,
  );
}

async function handleCommand(env: Env, chatId: string, text: string): Promise<void> {
  const [command, ...args] = text.split(/\s+/);

  switch (command) {
    case "/start":
    case "/help":
      await sendMessage(env, USAGE);
      return;
    case "/status":
      await handleStatus(env);
      return;
    case "/cancel":
      await handleCancel(env, args);
      return;
    case "/bump":
      await handleBump(env, args);
      return;
    default:
      await sendMessage(env, `Unknown command ${escapeHtml(command)} — /help for the list.`);
  }
}

async function handleStatus(env: Env): Promise<void> {
  const ids = await getActiveOrderIds(env.STATE);
  if (ids.length === 0) {
    await sendMessage(env, "No active orders.");
    return;
  }
  const lines: string[] = [];
  for (const id of ids) {
    const record = await getOrder(env.STATE, id);
    if (!record) continue;
    const when = record.pickupAtMs === undefined ? "ASAP" : formatSgtTime(record.pickupAtMs);
    lines.push(
      `<code>${id}</code> — ${escapeHtml(record.customerName)}, ${when}, ` +
        `fee $${record.currentFee.toFixed(2)}\n<a href="${record.shareLink}">📍 Track</a>`,
    );
  }
  await sendMessage(env, `<b>Active orders</b>\n\n${lines.join("\n\n")}`);
}

/** Resolve which order a bare /cancel or /bump refers to. */
async function resolveOrderId(env: Env, explicit?: string): Promise<string | { error: string }> {
  if (explicit) return explicit;
  const ids = await getActiveOrderIds(env.STATE);
  if (ids.length === 1) return ids[0];
  if (ids.length === 0) return { error: "No active orders." };
  return { error: `Several active orders — say which one, e.g. /cancel ${ids[0]}` };
}

async function handleCancel(env: Env, args: string[]): Promise<void> {
  const resolved = await resolveOrderId(env, args[0]);
  if (typeof resolved !== "string") {
    await sendMessage(env, resolved.error);
    return;
  }
  try {
    await new LalamoveClient(env).cancelOrder(resolved);
    await removeActiveOrder(env.STATE, resolved);
    await sendMessage(env, `🗑 Order <code>${resolved}</code> cancelled.`);
  } catch (e) {
    const detail = e instanceof LalamoveError ? e.message : String(e);
    await sendMessage(
      env,
      `❌ Couldn't cancel <code>${resolved}</code>: ${escapeHtml(detail)}\n` +
        `(Orders can only be cancelled before pickup, or within 5 minutes of a driver matching.)`,
    );
  }
}

async function handleBump(env: Env, args: string[]): Promise<void> {
  const amount = parseFloat(args[0] ?? "");
  if (!Number.isFinite(amount) || amount <= 0) {
    await sendMessage(env, "Usage: /bump 2 — adds $2 on top of the current priority fee.");
    return;
  }
  const resolved = await resolveOrderId(env, args[1]);
  if (typeof resolved !== "string") {
    await sendMessage(env, resolved.error);
    return;
  }
  const record = await getOrder(env.STATE, resolved);
  if (!record) {
    await sendMessage(env, `Order <code>${resolved}</code> isn't being tracked.`);
    return;
  }
  const newTotal = Math.round((record.currentFee + amount) * 100) / 100;
  try {
    await new LalamoveClient(env).addPriorityFee(resolved, newTotal.toFixed(2));
    await updateOrder(env.STATE, { ...record, currentFee: newTotal });
    await sendMessage(
      env,
      `💰 <b>Priority fee bumped</b>\n\n<code>${resolved}</code>: ` +
        `$${record.currentFee.toFixed(2)} → $${newTotal.toFixed(2)}`,
    );
  } catch (e) {
    const detail = e instanceof LalamoveError ? e.message : String(e);
    await sendMessage(
      env,
      `❌ Couldn't bump <code>${resolved}</code>: ${escapeHtml(detail)}\n` +
        `(Fees can only be added while Lalamove is still finding a driver.)`,
    );
  }
}
