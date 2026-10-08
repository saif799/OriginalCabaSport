/**
 * The URL contract for the stock history, shared by the server component that
 * reads it, the client controls that write it, and the pages that link in.
 * Everything the page shows is in the URL — the selection included — so a
 * history can be bookmarked, sent, or reached from an arrivage line.
 *
 * Free of server imports: the client controls import from here.
 */
import { isEventFamily, type EventFamily } from "@/lib/stock/eventFamily";

export type HistorySearchParams = {
  /** Colour variant ids, comma-separated. */
  shoes?: string;
  sizes?: string;
  families?: string;
  borrower?: string;
  /** Shop-local days, `YYYY-MM-DD`, inclusive. */
  from?: string;
  to?: string;
  page?: string;
};

export const HISTORY_PATH = "/admin/history";

/** `a,b,,a` -> ["a", "b"]: trimmed, de-duplicated, order kept. */
export function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((part) => part.trim()).filter(Boolean))];
}

export function parseFamilies(raw: string | undefined): EventFamily[] {
  return parseList(raw).filter(isEventFamily);
}

/** Where another page sends the owner to read these colours' history. */
export function historyHref({
  shoeIds,
  borrowerId,
}: {
  shoeIds: string[];
  borrowerId?: string;
}): string {
  const params = new URLSearchParams();
  if (shoeIds.length) params.set("shoes", shoeIds.join(","));
  if (borrowerId) params.set("borrower", borrowerId);
  const qs = params.toString();
  return qs ? `${HISTORY_PATH}?${qs}` : HISTORY_PATH;
}
