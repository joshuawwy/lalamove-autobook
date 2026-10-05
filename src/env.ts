export interface Env {
  STATE: KVNamespace;

  // Secrets
  LALAMOVE_API_KEY: string;
  LALAMOVE_API_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  LALAMOVE_WEBHOOK_SECRET: string;
  ONEMAP_EMAIL: string;
  ONEMAP_PASSWORD: string;

  // Vars (cloudflare.config.ts)
  LALAMOVE_ENV: string;
  LALAMOVE_MARKET: string;
  BASE_NAME: string;
  BASE_PHONE: string;
  BASE_ADDRESS: string;
  BASE_LAT: string;
  BASE_LNG: string;
  ASAP_WAIT_MIN: string;
  ASAP_STEP_FEE: string;
  ASAP_INTERVAL_MIN: string;
  ORDER_FEE_CAP: string;
  SCHEDULED_INTERVAL_MIN: string;
  GENTLE_START_MIN: string;
  GENTLE_END_MIN: string;
  GENTLE_FEE: string;
  AGGRESSIVE_START_MIN: string;
  AGGRESSIVE_FEE: string;
  AGGRESSIVE_FEE_VAN: string;
}
