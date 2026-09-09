import { createHash } from "node:crypto";
import { phoneKey } from "@/lib/orders/phone";
import { CURRENCY, type PixelContent } from "@/lib/storefront/pixel";

/**
 * The server half of Meta reporting: the Conversions API.
 *
 * WHY BOTH HALVES. `lib/storefront/pixel.ts` reports from the browser, which
 * an ad blocker, an iOS content blocker or a dropped script silently removes —
 * and that loss is not random, it skews toward exactly the audience segments
 * ad delivery is being trained on. This module reports the same conversion
 * from our server, where nothing can block it.
 *
 * DEDUPLICATION IS THE WHOLE CONTRACT. Both halves send the same
 * `event_id` (the order id, which is the courier's tracking number) and the
 * same `event_name`. Meta keeps the first arrival and drops the second for 48h.
 * Break that — send a different id, or omit it — and every storefront order is
 * counted twice, which quietly doubles reported ROAS. `getPurchaseContents`
 * exists so the two also agree on `value`.
 *
 * FAILURE IS ALWAYS SILENT. Every function here swallows its errors. A
 * customer's order must never fail, and must never be slowed, because Meta
 * returned a 500 — the order is the business, the tracking is a report about
 * it. Unset env (dev, previews, CI) is the same no-op, mirroring `track()`.
 *
 * TIMING. This fires at order *placement*, matching the browser Purchase.
 * See the header of `components/storefront/PurchaseTracker.tsx` for why that
 * deliberately does not agree with /admin/analytics revenue.
 */

const GRAPH_VERSION = "v21.0";

/** Meta wants normalized-then-SHA256 values, lowercase hex. */
function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Meta matches Algerian numbers far better in country-code form, digits only,
 * no `+` — the same `213…` shape `normalizePhone()` hands the browser pixel,
 * so the two halves hash identically. Built on `phoneKey` rather than a second
 * regex, because that is where the landline-vs-country-code trap is already
 * solved (see lib/orders/phone.ts).
 */
export function capiPhone(raw: string | null | undefined): string | null {
  const key = phoneKey(raw);
  return key === null ? null : `213${key}`;
}

/**
 * The identifying signals Meta can match a conversion on. `fbp`/`fbc` are the
 * first-party cookies the pixel script drops on our own domain, so a route
 * handler can read them straight off the request — they are by far the
 * strongest match signal available and are sent unhashed, as Meta specifies.
 */
export type CapiUserData = {
  phone?: string | null;
  /** The `_fbp` cookie, verbatim. */
  fbp?: string | null;
  /** The `_fbc` cookie, verbatim. Only exists after a click carrying `fbclid`. */
  fbc?: string | null;
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
};

export type CapiPurchase = {
  /** Must be the order id — the same value `PurchaseTracker` sends. */
  eventId: string;
  value: number;
  contentIds: string[];
  contents: PixelContent[];
  numItems: number;
  /** The page the customer converted on. */
  eventSourceUrl?: string | null;
  user: CapiUserData;
};

function buildUserData(user: CapiUserData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const ph = capiPhone(user.phone);
  // Hashed fields are arrays; unhashed ones are scalars.
  if (ph) out.ph = [hash(ph)];
  if (user.fbp) out.fbp = user.fbp;
  if (user.fbc) out.fbc = user.fbc;
  if (user.clientIpAddress) out.client_ip_address = user.clientIpAddress;
  if (user.clientUserAgent) out.client_user_agent = user.clientUserAgent;
  return out;
}

/**
 * Reports a Purchase. Resolves either way — callers are not expected to
 * branch on the result, only to `await` it so a serverless function is not
 * frozen mid-flight (see the `after()` call in POST /api/order).
 */
export async function sendPurchaseEvent(event: CapiPurchase): Promise<void> {
  const pixelId = process.env.FB_PIXEL_ID;
  const token = process.env.CONVERSION_API_ACCESS_TOKEN;
  // Both halves of the pair are required: firing server-side while the browser
  // pixel is dark would report conversions with no PageView funnel behind them.
  if (!pixelId || !token) return;

  const body = {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        event_id: event.eventId,
        action_source: "website",
        ...(event.eventSourceUrl
          ? { event_source_url: event.eventSourceUrl }
          : {}),
        user_data: buildUserData(event.user),
        custom_data: {
          currency: CURRENCY,
          value: event.value,
          content_type: "product",
          content_ids: event.contentIds,
          contents: event.contents,
          num_items: event.numItems,
        },
      },
    ],
    // Set this to route events into Events Manager > Test events instead of
    // live data. Leave it unset everywhere except while testing.
    ...(process.env.META_CAPI_TEST_EVENT_CODE
      ? { test_event_code: process.env.META_CAPI_TEST_EVENT_CODE }
      : {}),
    access_token: token,
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        // Meta being slow must not hold a serverless function open.
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) {
      // Never log the body of the request — it holds the access token.
      console.error(
        `[capi] Purchase ${event.eventId} rejected: ${res.status} ${await res.text()}`,
      );
    }
  } catch (error) {
    console.error(`[capi] Purchase ${event.eventId} failed:`, error);
  }
}

/**
 * Pulls the request-scoped match signals off an incoming request.
 *
 * `x-forwarded-for` is a comma-separated chain and the client is the FIRST
 * entry; taking the last gives Vercel's own proxy IP, which matches nobody.
 */
export function capiSignalsFromRequest(request: Request): {
  fbp: string | null;
  fbc: string | null;
  clientIpAddress: string | null;
  clientUserAgent: string | null;
  eventSourceUrl: string | null;
} {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookie = (name: string): string | null => {
    for (const part of cookieHeader.split(";")) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === name) {
        return decodeURIComponent(part.slice(eq + 1).trim()) || null;
      }
    }
    return null;
  };

  const forwarded = request.headers.get("x-forwarded-for");

  return {
    fbp: cookie("_fbp"),
    fbc: cookie("_fbc"),
    clientIpAddress: forwarded?.split(",")[0]?.trim() || null,
    clientUserAgent: request.headers.get("user-agent"),
    // The checkout page the customer submitted from — not the confirmation
    // page, which does not exist yet at this point.
    eventSourceUrl: request.headers.get("referer"),
  };
}
