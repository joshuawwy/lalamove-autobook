// Worker entry: routes the two webhooks and runs the escalation cron.
//   POST /telegram                       — Telegram updates (secret header)
//   POST /lalamove/<LALAMOVE_WEBHOOK_SECRET> — Lalamove status webhooks
//   GET  /health                         — liveness check

import { handleTelegramUpdate } from "./bot";
import type { Env } from "./env";
import { runMonitor } from "./monitor";
import { handleLalamoveWebhook } from "./webhook";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/" || pathname === "/health") {
      return new Response("OK");
    }

    if (pathname === "/telegram" && request.method === "POST") {
      if (
        request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET
      ) {
        return new Response("Forbidden", { status: 403 });
      }
      const update = await request.json();
      // Ack Telegram immediately; process in the background so slow Lalamove
      // calls never make Telegram retry (and double-process) the update.
      ctx.waitUntil(
        handleTelegramUpdate(env, update).catch((e) => console.error("Telegram update error:", e)),
      );
      return new Response("OK");
    }

    if (pathname === `/lalamove/${env.LALAMOVE_WEBHOOK_SECRET}` && request.method === "POST") {
      const payload = await request.json();
      ctx.waitUntil(
        handleLalamoveWebhook(env, payload).catch((e) => console.error("Webhook error:", e)),
      );
      return new Response("OK");
    }

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runMonitor(env));
  },
} satisfies ExportedHandler<Env>;
