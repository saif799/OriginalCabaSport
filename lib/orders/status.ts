import { db } from "@/lib/db";
import { stautsGroupsTable } from "@/lib/schema";

/**
 * The internal status names in status_groups_table.name. Not an exhaustive
 * closed set — the table is admin-editable — but these are relied on by name
 * elsewhere in the app (defaults, cancel/retour handling, analytics).
 */
export type OrderStatus =
  | "prete a expedier"
  | "en livraison"
  | "Livre"
  | "retour"
  | "Cancel";

/**
 * Name form of READY_TO_SHIP_STATUS_ID — for UI code that badges by name.
 *
 * Note the spaces: "prete_a_expedier" is one of that row's `external_statuses`
 * (the courier's wire value), NOT its `name`. Filtering/badging on the
 * underscored form silently matches nothing. Prefer the *_ID constants for
 * filtering; names are admin-editable and exist for display.
 */
export const READY_TO_SHIP_STATUS_NAME: OrderStatus = "prete a expedier";

// Hardcoded because these ids are relied on synchronously (schema defaults,
// SQL filters, a status set before the courier confirms cancellation) where
// an async table lookup isn't an option. This module is the single place
// they're defined; nothing else should inline them.
export const READY_TO_SHIP_STATUS_ID = "404332b3-998f-498f-a325-3e4ecf6c3bbb"; // "prete a expedier"
export const DELIVERED_STATUS_ID = "830826fd-80f5-4a29-829b-6421264c7695"; // "Livre"
export const RETURNED_STATUS_ID = "e4983321-f0c7-452d-8b36-68d42dfb7be4"; // "retour"
export const CANCELED_STATUS_ID = "e01a36c1-087c-46ab-aa4c-12b1a5186bf1"; // "Cancel"
// "en livraison" — the parcel is with the livreur. The only status the
// customer WhatsApp nudge is offered on, so the row action needs it
// synchronously while rendering the table.
export const EN_LIVRAISON_STATUS_ID = "6a066908-9417-4182-9367-cd0eac49dd62";
// The other two in-flight statuses. Nothing decides on them — they are named
// here only so a badge can be coloured by id like the rest.
export const EN_RAMASSAGE_STATUS_ID = "773fefbf-1de9-4d8d-bdc3-5629b74d51e8";
export const VERS_WILAYA_STATUS_ID = "8accf93f-383a-4f83-a898-33780301ad57";

/**
 * One colour per status, so a column of badges can be read without reading the
 * words. Keyed by id because names are admin-editable; a status added later has
 * no entry and keeps the plain outline.
 *
 * Class names are written out in full, never assembled: Tailwind only ships a
 * class it can find as a literal string in the source.
 */
const STATUS_BADGE_CLASS: Record<string, string> = {
  [READY_TO_SHIP_STATUS_ID]: "border-orange-300 bg-orange-100 text-orange-900",
  [EN_RAMASSAGE_STATUS_ID]: "border-yellow-300 bg-yellow-100 text-yellow-900",
  [VERS_WILAYA_STATUS_ID]: "border-violet-300 bg-violet-100 text-violet-900",
  [EN_LIVRAISON_STATUS_ID]: "border-blue-300 bg-blue-100 text-blue-900",
  [DELIVERED_STATUS_ID]: "border-green-300 bg-green-100 text-green-900",
  [RETURNED_STATUS_ID]: "border-red-300 bg-red-100 text-red-900",
  [CANCELED_STATUS_ID]: "border-gray-300 bg-gray-100 text-gray-700",
};

export function statusBadgeClass(statusId: string | null | undefined): string | undefined {
  return statusId ? STATUS_BADGE_CLASS[statusId] : undefined;
}

/**
 * An order on one of these has resolved: delivered, returned (its pairs are
 * already back in stock) or cancelled before it reached a courier. Every other
 * status is in flight.
 */
export const RESOLVED_STATUS_IDS: readonly string[] = [
  DELIVERED_STATUS_ID,
  RETURNED_STATUS_ID,
  CANCELED_STATUS_ID,
];

export type StatusGroupRow = {
  id: string;
  name: string;
  external_statuses: string[];
};

/** The full status_groups_table, unfiltered — callers that also need external_statuses. */
export async function getAllStatusGroups(): Promise<StatusGroupRow[]> {
  return db.select().from(stautsGroupsTable);
}

export function buildNameToIdMap(rows: { id: string; name: string }[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of rows) map[row.name] = row.id;
  return map;
}

export function buildIdToNameMap(rows: { id: string; name: string }[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of rows) map[row.id] = row.name;
  return map;
}
