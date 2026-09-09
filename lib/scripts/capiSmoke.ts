/**
 * Sends one synthetic Purchase through the real `lib/storefront/capi` path,
 * so a broken token, a wrong dataset id or a rejected payload shows up here
 * rather than as a silent gap in Ads Manager weeks later.
 *
 * Run from repo root:
 *   npx tsx lib/scripts/capiSmoke.ts
 *
 * It forces `test_event_code`, so the event lands in Events Manager >
 * Test events and never in live data. Watch that tab while it runs.
 *
 * `sendPurchaseEvent` deliberately swallows its failures, so this wraps fetch
 * to print what Meta actually answered - "no error logged" is not proof.
 */
import dotenv from "dotenv";
dotenv.config();

import { sendPurchaseEvent } from "@/lib/storefront/capi";

/** Events Manager > Test events shows the current code; override in .env. */
process.env.META_CAPI_TEST_EVENT_CODE ||= "TEST88448";

const realFetch = globalThis.fetch;
globalThis.fetch = async (...args: Parameters<typeof realFetch>) => {
  const res = await realFetch(...args);
  // `events_received: 1` with an empty `messages` array is a clean send;
  // anything in `messages` is Meta complaining about the payload.
  console.log("HTTP", res.status, await res.clone().text());
  return res;
};

void (async () => {
  if (!process.env.FB_PIXEL_ID || !process.env.CONVERSION_API_ACCESS_TOKEN) {
    console.error(
      "FB_PIXEL_ID and CONVERSION_API_ACCESS_TOKEN must both be set - capi.ts no-ops without them.",
    );
    process.exit(1);
  }

  await sendPurchaseEvent({
    eventId: `capi-smoke-${Date.now()}`,
    value: 7500,
    contentIds: ["CAPI-SMOKE-SKU"],
    contents: [{ id: "CAPI-SMOKE-SKU", quantity: 1, item_price: 7500 }],
    numItems: 1,
    eventSourceUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/fr/product/CAPI-SMOKE`,
    user: {
      // A real-shaped Algerian mobile: capiPhone turns it into 213555605770
      // before hashing, the same string the browser pixel hashes.
      phone: "0555605770",
      fbp: "fb.1.1700000000000.1234567890",
      fbc: null,
      clientIpAddress: "41.100.0.1",
      clientUserAgent:
        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36",
    },
  });
})();
