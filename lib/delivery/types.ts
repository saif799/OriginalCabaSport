/**
 * Provider-agnostic delivery abstraction. Order create/delete/sync routes talk
 * to this interface instead of hardcoding one shipping company, so DHD (Ecotrack)
 * and Yalidine can coexist. Which provider an order uses is stored on
 * `ordersTable.provider`.
 */

export type DeliveryProviderName = "dhd" | "yalidine";

/** The order fields the UI collects, in the app's existing (DHD-shaped) format. */
export type NormalizedOrderInput = {
  nom_client: string;
  telephone: string;
  telephone_2?: string | null;
  adresse: string;
  commune: string; // provider-native commune name (DHD or Yalidine spelling)
  code_wilaya: string; // numeric string, e.g. "16"
  montant: string;
  remarque?: string | null;
  produit: string;
  type: number; // 1 = livraison, 2 = echange
  stop_desk: number; // 0 = a domicile, 1 = bureau / stop desk
};

export type CreateOrderResult = { tracking: string };
export type DeleteOrderResult = { ok: boolean };
export type ProviderStatus = { tracking: string; status: string };

/** Our own order ids for one provider, as handed to `fetchStatuses`. */
export type SyncTargets = {
  /** Every order we hold for this provider. Yalidine filters its histories query by these. */
  all: string[];
  /**
   * The subset still in flight — not delivered, returned or cancelled. DHD's
   * bulk listing drops parcels once they settle, so DHD looks these up one by
   * one when the listing no longer carries them.
   */
  inFlight: string[];
};

export interface DeliveryProvider {
  name: DeliveryProviderName;
  createOrder(input: NormalizedOrderInput): Promise<CreateOrderResult>;
  deleteOrder(tracking: string): Promise<DeleteOrderResult>;
  /**
   * The current status of our parcels, for sync. May also return parcels that
   * are not ours (DHD lists everything on the account); the caller ignores those.
   */
  fetchStatuses(targets: SyncTargets): Promise<ProviderStatus[]>;
}
