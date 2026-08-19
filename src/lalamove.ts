// Lalamove API v3 client (HMAC-SHA256 auth), ported from the TouristPads
// Python client. Quotation -> order two-step; priority fee replaces the
// previous amount and must exceed it.

import type { Vehicle } from "./escalation";
import type { ParsedOrder } from "./parse";

export const SERVICE_TYPE: Record<Vehicle, string> = {
  CAR: "CAR",
  MPV: "MPV",
  VAN: "MINIVAN", // the 1.7m van; Lalamove's "VAN" is the bigger 2.4m one
};

const STATUS_HINTS: Record<number, string> = {
  401: "Invalid API credentials",
  402: "Insufficient wallet balance — top up at wallet.lalamove.com",
  403: "Forbidden — account may be suspended",
  409: "Duplicate order or conflicting request",
  422: "Invalid request data (check coordinates, phone, schedule time)",
  429: "Rate limited — too many requests",
};

export class LalamoveError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: unknown,
  ) {
    super(message);
  }
}

export interface LalamoveEnv {
  LALAMOVE_API_KEY: string;
  LALAMOVE_API_SECRET: string;
  LALAMOVE_MARKET: string;
  LALAMOVE_ENV: string;
}

export interface Place {
  address: string;
  lat: number;
  lng: number;
}

export interface BasePlace extends Place {
  name: string;
  phone: string;
}

export async function generateSignature(
  secret: string,
  method: string,
  path: string,
  timestamp: number,
  body = "",
): Promise<string> {
  const raw = `${timestamp}\r\n${method}\r\n${path}\r\n\r\n${body}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(raw));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface QuotationPayload {
  data: {
    serviceType: string;
    language: string;
    stops: Array<{ coordinates: { lat: string; lng: string }; address: string }>;
    scheduleAt?: string;
  };
}

export function buildQuotationPayload(
  order: ParsedOrder,
  base: BasePlace,
  dropoff: Place,
): QuotationPayload {
  const data: QuotationPayload["data"] = {
    serviceType: SERVICE_TYPE[order.vehicle],
    language: "en_SG",
    stops: [
      {
        coordinates: { lat: base.lat.toFixed(7), lng: base.lng.toFixed(7) },
        address: base.address,
      },
      {
        coordinates: { lat: dropoff.lat.toFixed(7), lng: dropoff.lng.toFixed(7) },
        address: dropoff.address,
      },
    ],
  };
  if (order.pickupAtMs !== null) {
    data.scheduleAt = new Date(order.pickupAtMs).toISOString().replace(/\.\d{3}Z$/, ".00Z");
  }
  return { data };
}

export class LalamoveClient {
  constructor(private env: LalamoveEnv) {}

  private get baseUrl(): string {
    return this.env.LALAMOVE_ENV === "production"
      ? "https://rest.lalamove.com"
      : "https://rest.sandbox.lalamove.com";
  }

  private async request(method: string, path: string, body?: unknown): Promise<any> {
    const bodyStr = body === undefined ? "" : JSON.stringify(body);
    const timestamp = Date.now();
    const signature = await generateSignature(
      this.env.LALAMOVE_API_SECRET,
      method,
      path,
      timestamp,
      bodyStr,
    );

    const resp = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `hmac ${this.env.LALAMOVE_API_KEY}:${timestamp}:${signature}`,
        Market: this.env.LALAMOVE_MARKET,
        "Request-ID": crypto.randomUUID(),
      },
      body: bodyStr || undefined,
    });

    const text = await resp.text();
    if (resp.ok) return text ? JSON.parse(text) : {};

    let respData: any = null;
    try {
      respData = text ? JSON.parse(text) : null;
    } catch {
      // non-JSON error body; keep raw text out of the message
    }
    const apiMessage =
      respData?.errors?.find((e: any) => typeof e?.message === "string")?.message ??
      respData?.message ??
      respData?.detail ??
      "";
    const hint = STATUS_HINTS[resp.status] ?? "";
    const parts = [`API error ${resp.status}`, hint, apiMessage].filter(Boolean);
    throw new LalamoveError(parts.join(" — "), resp.status, respData);
  }

  async getQuotation(payload: QuotationPayload): Promise<{
    quotationId: string;
    stopIds: [string, string];
    price: string;
    currency: string;
  }> {
    const result = await this.request("POST", "/v3/quotations", payload);
    const data = result.data ?? {};
    const stops: Array<{ stopId?: string }> = data.stops ?? [];
    if (!data.quotationId || stops.length < 2) {
      throw new LalamoveError("Quotation response missing quotationId or stops");
    }
    return {
      quotationId: data.quotationId,
      stopIds: [stops[0].stopId ?? "", stops[1].stopId ?? ""],
      price: data.priceBreakdown?.total ?? "?",
      currency: data.priceBreakdown?.currency ?? "SGD",
    };
  }

  async createOrder(
    quotationId: string,
    stopIds: [string, string],
    base: BasePlace,
    order: ParsedOrder,
  ): Promise<{ orderId: string; shareLink: string }> {
    const payload = {
      data: {
        quotationId,
        sender: { stopId: stopIds[0], name: base.name, phone: base.phone },
        recipients: [
          { stopId: stopIds[1], name: order.name, phone: order.phone, remarks: order.notes },
        ],
      },
    };
    const result = await this.request("POST", "/v3/orders", payload);
    const data = result.data ?? {};
    const orderId = data.orderId;
    if (!orderId) {
      throw new LalamoveError("Order response missing orderId", undefined, result);
    }
    return {
      orderId,
      shareLink: data.shareLink ?? `https://web.lalamove.com/track?order=${orderId}`,
    };
  }

  async getOrderStatus(orderId: string): Promise<string> {
    const result = await this.request("GET", `/v3/orders/${orderId}`);
    return result.data?.status ?? "";
  }

  async addPriorityFee(orderId: string, amount: string): Promise<void> {
    await this.request("POST", `/v3/orders/${orderId}/priority-fee`, {
      data: { priorityFee: amount },
    });
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.request("DELETE", `/v3/orders/${orderId}`);
  }
}
