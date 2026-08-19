// OneMap (SG government) geocoder. Free, but two quirks shape this module:
// tokens expire every 3 days (auto-renewed via KV cache), and search is
// literal — "Blk" prefixes and unit numbers return zero results.

export interface GeocodeCandidate {
  /** OneMap SEARCHVAL — the building/POI name it matched. */
  label: string;
  /** Clean one-line display address. */
  address: string;
  postal: string;
  lat: number;
  lng: number;
}

export function normalizeSearchQuery(raw: string): string {
  let q = raw.trim();

  // Bare postal code, optionally written as S238895 or S(238895).
  const postal = q.match(/^[sS]?\(?(\d{6})\)?$/);
  if (postal) return postal[1];

  q = q.replace(/\b(?:blk|block)\b\.?\s*/gi, "");
  q = q.replace(/#\d{1,3}-\d{1,4}\S*/g, "");
  return q.replace(/\s{2,}/g, " ").trim();
}

const TOKEN_KEY = "onemap:token";
const SEARCH_URL = "https://www.onemap.gov.sg/api/common/elastic/search";
const TOKEN_URL = "https://www.onemap.gov.sg/api/auth/post/getToken";

async function getToken(env: { STATE: KVNamespace; ONEMAP_EMAIL: string; ONEMAP_PASSWORD: string }): Promise<string> {
  const cached = await env.STATE.get(TOKEN_KEY);
  if (cached) return cached;

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: env.ONEMAP_EMAIL, password: env.ONEMAP_PASSWORD }),
  });
  if (!resp.ok) {
    throw new Error(`OneMap token request failed: HTTP ${resp.status}`);
  }
  const data = (await resp.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("OneMap token response had no access_token");

  // Tokens live 3 days; cache for 2.5 so we always renew before expiry.
  await env.STATE.put(TOKEN_KEY, data.access_token, { expirationTtl: 60 * 60 * 60 });
  return data.access_token;
}

/** Search OneMap; returns up to `limit` candidates, best first. */
export async function geocode(
  env: { STATE: KVNamespace; ONEMAP_EMAIL: string; ONEMAP_PASSWORD: string },
  rawQuery: string,
  limit = 3,
): Promise<GeocodeCandidate[]> {
  const query = normalizeSearchQuery(rawQuery);
  const url = `${SEARCH_URL}?searchVal=${encodeURIComponent(query)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;

  let token = await getToken(env);
  let resp = await fetch(url, { headers: { Authorization: token } });
  if (resp.status === 401) {
    // Token expired early — drop the cache and retry once with a fresh one.
    await env.STATE.delete(TOKEN_KEY);
    token = await getToken(env);
    resp = await fetch(url, { headers: { Authorization: token } });
  }
  if (!resp.ok) throw new Error(`OneMap search failed: HTTP ${resp.status}`);

  const data = (await resp.json()) as {
    results?: Array<Record<string, string>>;
  };

  return (data.results ?? []).slice(0, limit).map((r) => ({
    label: clean(r.SEARCHVAL),
    address: clean(r.ADDRESS),
    postal: r.POSTAL === "NIL" ? "" : (r.POSTAL ?? ""),
    lat: parseFloat(r.LATITUDE),
    lng: parseFloat(r.LONGITUDE),
  }));
}

/** OneMap fields occasionally embed \r\n inside values. */
function clean(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}
