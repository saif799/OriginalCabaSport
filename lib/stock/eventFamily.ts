import type { MovementReason } from "./movement";

/** Every reason a Movement Ledger row can carry. */
export type LedgerReason = MovementReason | "correction";

/**
 * How the stock history groups the nine reasons for a reader: by what happened
 * to the pairs, not by which code path moved them. One family is one colour on
 * the page and one chip in its filter.
 *
 * Free of server imports — the filter chips are a client component.
 */
export const EVENT_FAMILIES = [
  "arrived",
  "sold",
  "came-back",
  "lent",
  // Not "returned": that word already means a customer's retour and an
  // Échange's Returned Pair. This is a Borrower handing pairs back.
  "brought-back",
  "correction",
] as const;

export type EventFamily = (typeof EVENT_FAMILIES)[number];

const FAMILY_OF: Record<LedgerReason, EventFamily> = {
  arrival: "arrived",
  sale: "sold",
  "borrower-sale": "sold",
  cancel: "came-back",
  retour: "came-back",
  "echange-return": "came-back",
  lend: "lent",
  return: "brought-back",
  correction: "correction",
};

/** An unknown reason reads as a correction rather than throwing on a page render. */
export function eventFamily(reason: string): EventFamily {
  return FAMILY_OF[reason as LedgerReason] ?? "correction";
}

export function reasonsOf(families: readonly EventFamily[]): LedgerReason[] {
  return (Object.keys(FAMILY_OF) as LedgerReason[]).filter((reason) =>
    families.includes(FAMILY_OF[reason]),
  );
}

export function isEventFamily(value: string): value is EventFamily {
  return (EVENT_FAMILIES as readonly string[]).includes(value);
}

/**
 * A lend or a bring-back changes where pairs sit, never how many there are
 * (ADR-0003): it is counted in pairs that changed hands, and a stock level
 * beside it would only suggest Physical Quantity had moved.
 */
export function movesLocationOnly(family: EventFamily): boolean {
  return family === "lent" || family === "brought-back";
}

/**
 * Class names are written out in full, never assembled: Tailwind only ships a
 * class it can find as a literal string in the source.
 */
export const FAMILY_META: Record<
  EventFamily,
  { label: string; bar: string; badge: string; text: string }
> = {
  arrived: {
    label: "Arrived",
    bar: "bg-green-500",
    badge: "border-transparent bg-green-100 text-green-900",
    text: "text-green-700",
  },
  sold: {
    label: "Sold",
    bar: "bg-blue-500",
    badge: "border-transparent bg-blue-100 text-blue-900",
    text: "text-blue-700",
  },
  "came-back": {
    label: "Came back",
    bar: "bg-orange-500",
    badge: "border-transparent bg-orange-100 text-orange-900",
    text: "text-orange-700",
  },
  lent: {
    label: "Lent",
    bar: "bg-amber-400",
    badge: "border-transparent bg-amber-100 text-amber-900",
    text: "text-amber-700",
  },
  "brought-back": {
    label: "Back from borrower",
    bar: "bg-teal-500",
    badge: "border-transparent bg-teal-100 text-teal-900",
    text: "text-teal-700",
  },
  correction: {
    label: "Correction",
    bar: "bg-gray-400",
    badge: "border-transparent bg-gray-100 text-gray-800",
    text: "text-gray-600",
  },
};

/**
 * The second, quieter label on a row: which kind of sale, which kind of
 * coming back. Store versus online is read off the order link rather than
 * stored — a sale no order is attached to was rung up in the shop.
 */
export function eventSubLabel(
  reason: string,
  hasOrder: boolean,
  borrowerName?: string | null,
): string | null {
  switch (reason) {
    case "sale":
      return hasOrder ? "Online" : "Store";
    case "borrower-sale":
      return `Via ${borrowerName ?? "borrower"}`;
    case "cancel":
      return hasOrder ? "Order cancelled" : "Store sale reverted";
    case "retour":
      return "Retour";
    case "echange-return":
      return "Échange";
    default:
      return null;
  }
}
