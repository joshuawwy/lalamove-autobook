import { describe, expect, it } from "vitest";
import { normalizeSearchQuery } from "../src/onemap";

// OneMap's search is literal (no fuzz): "Blk"/"Block" prefixes return zero
// results, and unit numbers pollute the query. Live-tested findings from the
// OneMap research pass.
describe("normalizeSearchQuery", () => {
  it("strips Blk/Block words", () => {
    expect(normalizeSearchQuery("Blk 123 Ang Mo Kio Ave 3")).toBe("123 Ang Mo Kio Ave 3");
    expect(normalizeSearchQuery("Block 45 Bedok North St 1")).toBe("45 Bedok North St 1");
  });

  it("strips unit numbers like #05-12", () => {
    expect(normalizeSearchQuery("313 Orchard Rd #05-12")).toBe("313 Orchard Rd");
  });

  it("leaves ordinary queries alone", () => {
    expect(normalizeSearchQuery("Swissotel The Stamford")).toBe("Swissotel The Stamford");
  });

  it("recognizes a bare 6-digit postal code (with or without S prefix)", () => {
    expect(normalizeSearchQuery("238895")).toBe("238895");
    expect(normalizeSearchQuery("S238895")).toBe("238895");
    expect(normalizeSearchQuery(" s(238895) ")).toBe("238895");
  });

  it("does not mangle block numbers that merely contain 6 digits", () => {
    expect(normalizeSearchQuery("123456 is not my address")).toBe("123456 is not my address");
  });
});
