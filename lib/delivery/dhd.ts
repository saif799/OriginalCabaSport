import type { DeliveryOrderType } from "@/lib/dataTypes";
import type {
  CreateOrderResult,
  DeleteOrderResult,
  DeliveryProvider,
  NormalizedOrderInput,
  ProviderStatus,
  SyncTargets,
} from "./types";
import { fetchDhdTrackingStatuses } from "./dhdTrackings";

const BASE_URL = "https://platform.dhd-dz.com/api/v1";

// Bounds the get/orders walk so a bad `next_page_url` cannot spin the cron. At
// 40 a page this is 2,000 active parcels; anything past it that is ours and
// in flight is still caught by the trackings/info lookup.
const MAX_LISTING_PAGES = 50;

function authHeader() {
  return `Bearer ${process.env.NEXT_PUBLIC_DHD_API_KEY}`;
}

/**
 * DHD / Ecotrack provider. This just relocates the fetch calls that previously
 * lived inline in the order/status routes — behaviour is unchanged.
 */
export const dhdProvider: DeliveryProvider = {
  name: "dhd",

  async createOrder(input: NormalizedOrderInput): Promise<CreateOrderResult> {
    const res = await fetch(`${BASE_URL}/create/order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: authHeader(),
      },
      body: JSON.stringify({
        nom_client: input.nom_client,
        telephone: input.telephone,
        adresse: input.adresse,
        code_wilaya: input.code_wilaya,
        commune: input.commune,
        montant: input.montant,
        reference: input.produit,
        produit: input.produit,
        type: input.type,
        stop_desk: input.stop_desk,
        remarque: input.remarque,
        telephone_2: input.telephone_2,
      }),
    });

    if (!res.ok) {
      throw new Error("DHD failed to create order");
    }

    const apiResponse = await res.json();
    const tracking: string | undefined = apiResponse?.tracking;
    if (!tracking) {
      throw new Error("DHD did not return a tracking number");
    }
    return { tracking };
  },

  async deleteOrder(tracking: string): Promise<DeleteOrderResult> {
    const res = await fetch(
      `${BASE_URL}/delete/order?tracking=${encodeURIComponent(tracking)}`,
      {
        method: "DELETE",
        headers: { authorization: authHeader() },
      },
    );

    if (!res.ok) {
      throw new Error("DHD failed to delete order");
    }

    const apiResponse = await res.json();
    return { ok: apiResponse?.delete === "success" };
  },

  async fetchStatuses({ inFlight }: SyncTargets): Promise<ProviderStatus[]> {
    // Keyed by tracking: a parcel can straddle two pages if one is created
    // mid-walk, and the route must see exactly one status per order per sync
    // (two would race the retour claim against a later overwrite).
    const statuses = new Map<string, string>();
    for (const o of await fetchListedOrders()) statuses.set(o.tracking, o.status);

    // get/orders only lists parcels DHD still considers active: once one
    // settles it drops off, and a transition that lands after our last sync is
    // never seen. Ask for our in-flight orders it no longer carries directly.
    const unlisted = inFlight.filter((t) => !statuses.has(t));
    try {
      for (const o of await fetchDhdTrackingStatuses(unlisted)) {
        statuses.set(o.tracking, o.status);
      }
    } catch (e) {
      // The listing is still worth applying on its own.
      console.log("DHD trackings/info lookup failed", e);
    }

    return Array.from(statuses, ([tracking, status]) => ({ tracking, status }));
  },
};

/** Every parcel get/orders lists, following its Laravel pagination (40 a page). */
async function fetchListedOrders(): Promise<DeliveryOrderType[]> {
  const orders: DeliveryOrderType[] = [];
  for (let page = 1; page <= MAX_LISTING_PAGES; page++) {
    const res = await fetch(`${BASE_URL}/get/orders?page=${page}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        authorization: authHeader(),
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch orders from DHD (page ${page})`);
    }

    const data: { data: DeliveryOrderType[]; next_page_url: string | null } =
      await res.json();
    orders.push(...data.data);
    if (!data.next_page_url || data.data.length === 0) return orders;
  }
  console.log(`DHD get/orders still paginating after ${MAX_LISTING_PAGES} pages`);
  return orders;
}
