import type { Env } from "./env";

interface InlineKeyboard {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
}

async function api(env: Env, method: string, payload: Record<string, unknown>): Promise<any> {
  const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data: any = await resp.json().catch(() => null);
  if (!resp.ok) console.error(`Telegram ${method} failed:`, resp.status, JSON.stringify(data));
  return data;
}

export function sendMessage(
  env: Env,
  text: string,
  options: { chatId?: string; keyboard?: InlineKeyboard } = {},
): Promise<any> {
  return api(env, "sendMessage", {
    chat_id: options.chatId ?? env.TELEGRAM_CHAT_ID,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(options.keyboard ? { reply_markup: options.keyboard } : {}),
  });
}

export function sendPhoto(env: Env, photoUrl: string, caption: string): Promise<any> {
  return api(env, "sendPhoto", {
    chat_id: env.TELEGRAM_CHAT_ID,
    photo: photoUrl,
    caption,
    parse_mode: "HTML",
  });
}

export function answerCallback(env: Env, callbackId: string, text?: string): Promise<any> {
  return api(env, "answerCallbackQuery", { callback_query_id: callbackId, ...(text ? { text } : {}) });
}

/** Remove the buttons from a card once it has been acted on. */
export function clearButtons(env: Env, chatId: string, messageId: number): Promise<any> {
  return api(env, "editMessageReplyMarkup", { chat_id: chatId, message_id: messageId });
}

export function buttonRows(
  rows: Array<Array<{ text: string; data: string }>>,
): InlineKeyboard {
  return {
    inline_keyboard: rows.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))),
  };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
