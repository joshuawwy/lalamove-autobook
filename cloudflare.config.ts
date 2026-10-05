// lalamove-autobook — single Worker: Telegram bot + Lalamove webhooks + escalation cron.
// Deploy with `npm run deploy` (`cf deploy`); check without uploading with `npm run check`.
//
// Secrets are set with `npx wrangler secret put <NAME> --name lalamove-autobook`
// (cf has no `secret put` yet) or `cf deploy --secrets-file <file>`. Every
// secret must ALSO be named below as `bindings.secret()`: `cf deploy` deletes
// any secret on the Worker that this file does not name.
//   LALAMOVE_API_KEY, LALAMOVE_API_SECRET  — Lalamove Partner Portal → Developers
//   TELEGRAM_BOT_TOKEN                     — from @BotFather
//   TELEGRAM_CHAT_ID                       — the Operator's chat with the bot
//   TELEGRAM_WEBHOOK_SECRET                — random string, also passed to setWebhook
//   LALAMOVE_WEBHOOK_SECRET                — random string, embedded in the webhook URL
//                                            you register in the Lalamove Partner Portal
//   ONEMAP_EMAIL, ONEMAP_PASSWORD          — OneMap account (token auto-renews every 3 days)
import { bindings, defineConfig, triggers } from "cf/config";

export default defineConfig({
	worker: {
		name: "lalamove-autobook",
		compatibilityDate: "2026-08-01",
		entrypoint: "src/index.ts",
		triggers: [
			triggers.scheduled({
				schedule: "* * * * *",
			}),
		],
		env: {
			LALAMOVE_ENV: bindings.text("sandbox"), // switch to "production" once tested
			LALAMOVE_MARKET: bindings.text("SG"),

			// Your fixed pickup location (the Base) and sender identity.
			BASE_NAME: bindings.text("Your Bakery"),
			BASE_PHONE: bindings.text("+6591234567"),
			BASE_ADDRESS: bindings.text("1 Example Road, Singapore 123456"),
			BASE_LAT: bindings.text("1.3000000"),
			BASE_LNG: bindings.text("103.8000000"),

			// Escalation ramp (all fees in SGD, totals not increments — Lalamove replaces
			// the previous priority fee and each new amount must exceed it).
			ASAP_WAIT_MIN: bindings.text("5"), // organic-match wait before the first bump
			ASAP_STEP_FEE: bindings.text("1"), // fee total grows by this much per interval
			ASAP_INTERVAL_MIN: bindings.text("5"),
			ORDER_FEE_CAP: bindings.text("5"), // hard per-order cap, both modes

			// Scheduled-order tiers (minutes are relative to pickup time).
			SCHEDULED_INTERVAL_MIN: bindings.text("5"), // minutes between bumps within the tiers
			GENTLE_START_MIN: bindings.text("30"),
			GENTLE_END_MIN: bindings.text("15"),
			GENTLE_FEE: bindings.text("0.5"),
			AGGRESSIVE_START_MIN: bindings.text("10"),
			AGGRESSIVE_FEE: bindings.text("2"),
			AGGRESSIVE_FEE_VAN: bindings.text("4"),

			STATE: bindings.kv({
				id: "REPLACE_WITH_YOUR_KV_NAMESPACE_ID",
			}),

			LALAMOVE_API_KEY: bindings.secret(),
			LALAMOVE_API_SECRET: bindings.secret(),
			TELEGRAM_BOT_TOKEN: bindings.secret(),
			TELEGRAM_CHAT_ID: bindings.secret(),
			TELEGRAM_WEBHOOK_SECRET: bindings.secret(),
			LALAMOVE_WEBHOOK_SECRET: bindings.secret(),
			ONEMAP_EMAIL: bindings.secret(),
			ONEMAP_PASSWORD: bindings.secret(),
		},
	},
});
