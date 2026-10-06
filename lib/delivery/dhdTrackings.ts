import type { ProviderStatus } from "./types";

const BASE_URL = "https://platform.dhd-dz.com/api/v1";
// get/trackings/info answers HTTP 422 to more than 100 trackings at once.
const TRACKINGS_PER_LOOKUP = 100;

/**
 * The current status of specific DHD parcels, asked for by tracking through
 * `get/trackings/info` — the only endpoint that returns an Échange's Delivery
 * Leg (`<tracking>-EXCH`), which never appears in `get/orders` (ADR-0009).
 *
 * Trackings DHD does not know are simply absent from the result: for a Delivery
 * Leg, that absence is what says the swap has not happened. Statuses come back
 * as French display labels ("Livre non encaissé", "Retours prêts"), not
 * get/orders' snake_case codes, so status_groups_table must map both. Throws on
 * an HTTP failure, so a caller never mistakes "DHD did not answer" for "DHD has
 * no such parcel".
 */
export async function fetchDhdTrackingStatuses(
  trackings: string[],
): Promise<ProviderStatus[]> {
  const out: ProviderStatus[] = [];
  for (let i = 0; i < trackings.length; i += TRACKINGS_PER_LOOKUP) {
    const batch = trackings.slice(i, i + TRACKINGS_PER_LOOKUP);
    const query = batch
      .map((t) => `trackings[]=${encodeURIComponent(t)}`)
      .join("&");
    const res = await fetch(`${BASE_URL}/get/trackings/info?${query}`, {
      method: "GET",
      headers: { authorization: `Bearer ${process.env.NEXT_PUBLIC_DHD_API_KEY}` },
    });

    if (!res.ok) {
      throw new Error(`DHD trackings/info failed (HTTP ${res.status})`);
    }

    const data: Record<string, { status?: unknown } | null> = await res.json();
    for (const tracking of batch) {
      const status = data?.[tracking]?.status;
      if (typeof status === "string" && status) out.push({ tracking, status });
    }
  }
  return out;
}
