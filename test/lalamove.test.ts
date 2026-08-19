import { describe, expect, it } from "vitest";
import { buildQuotationPayload, generateSignature, SERVICE_TYPE } from "../src/lalamove";
import type { ParsedOrder } from "../src/parse";

describe("generateSignature", () => {
  // Expected values computed independently with Python's hmac using the
  // TouristPads production client's algorithm.
  it("signs a POST with body", async () => {
    const sig = await generateSignature(
      "test-secret",
      "POST",
      "/v3/quotations",
      1755500000000,
      '{"data":{"x":1}}',
    );
    expect(sig).toBe("0cec9262490e18c1e1cfcc25c4a5becb24e3c3ae67879bf5ce7d9cc371971939");
  });

  it("signs a GET with empty body", async () => {
    const sig = await generateSignature("test-secret", "GET", "/v3/orders/123", 1755500000000);
    expect(sig).toBe("816d7e09100f722729b72299be30323d01181390e58827b2e6bf8615d1fe00bc");
  });
});

describe("buildQuotationPayload", () => {
  const base = { name: "Bakery", phone: "+6591112222", address: "1 Example Rd", lat: 1.3, lng: 103.8 };
  const order: ParsedOrder = {
    addressQuery: "313 Orchard Rd",
    name: "Sarah",
    phone: "+6591234567",
    vehicle: "VAN",
    notes: "fragile",
    pickupAtMs: Date.parse("2026-08-19T07:00:00Z"),
  };
  const dropoff = { address: "313 ORCHARD ROAD 313@SOMERSET SINGAPORE 238895", lat: 1.30086, lng: 103.83872 };

  it("maps VAN to Lalamove's MINIVAN (the 1.7m van, not the 2.4m VAN)", () => {
    expect(SERVICE_TYPE.VAN).toBe("MINIVAN");
  });

  it("builds base->dropoff stops with 7dp string coordinates and scheduleAt", () => {
    const p = buildQuotationPayload(order, base, dropoff);
    expect(p.data.serviceType).toBe("MINIVAN");
    expect(p.data.stops[0].coordinates).toEqual({ lat: "1.3000000", lng: "103.8000000" });
    expect(p.data.stops[1].address).toBe(dropoff.address);
    expect(p.data.scheduleAt).toBe("2026-08-19T07:00:00.00Z");
  });

  it("omits scheduleAt for ASAP orders", () => {
    const p = buildQuotationPayload({ ...order, pickupAtMs: null }, base, dropoff);
    expect(p.data.scheduleAt).toBeUndefined();
  });
});
