// What the add-shoes form and its routes agree on. No db imports: the form
// bundles this file.

export type ArrivalSize = { size: string; quantity: number };

/** One line of the `POST /api/arrivals` payload. */
export type ArrivalLine =
  | { mode: "new"; modelId: string; color: string; sizes: ArrivalSize[] }
  | { mode: "existing"; shoeId: string; sizes: ArrivalSize[] };

/** A colour the arrivage created, as the response lists it. */
export type CreatedColour = { shoeId: string; modelName: string; color: string };

/** One colour of a model as `GET /api/shoes?modelId=` returns it. */
export type ModelColour = {
  id: string;
  color: string;
  archived: boolean;
  /** Every size the colour has, with its Physical Quantity. */
  sizes: ArrivalSize[];
};

/**
 * One staged line of the arrivage. The cart holds at most one per colour:
 * `key` is `shoe:<shoeId>` for a colour that exists, `new:<modelId>:<colorKey>`
 * for one this arrivage will create.
 */
export type CartLine = {
  key: string;
  mode: "new" | "existing";
  modelId: string;
  modelName: string;
  color: string;
  shoeId?: string;
  sizes: ArrivalSize[];
};

export type ArrivageDraft = {
  cart: CartLine[];
  reference: string;
  note: string;
};

/** A model with no sizes yet starts from the EU run the shop actually stocks. */
export const DEFAULT_SIZES = [
  "36", "37", "38", "39", "40", "41", "42", "43", "44", "45",
];

/** Numeric sizes in numeric order (36.5 between 36 and 37); anything else after. */
export function sortSizes(sizes: Iterable<string>): string[] {
  return Array.from(new Set(sizes)).sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    const aIsNumber = a.trim() !== "" && Number.isFinite(na);
    const bIsNumber = b.trim() !== "" && Number.isFinite(nb);
    if (aIsNumber && bIsNumber) return na - nb;
    if (aIsNumber) return -1;
    if (bIsNumber) return 1;
    return a.localeCompare(b);
  });
}

/**
 * What the owner typed into "+ size", as the size it names — or null when it
 * is not a number. Halves are real sizes here (`36.5`), a comma is accepted
 * for the decimal point, and `42.0` is `42` so it cannot sit beside it.
 */
export function parseSizeInput(raw: string): string | null {
  const text = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  return value > 0 ? String(value) : null;
}

export function linePairs(line: Pick<CartLine, "sizes">): number {
  return line.sizes.reduce((sum, s) => sum + s.quantity, 0);
}

/**
 * Reads a draft back out of localStorage. Anything that is not the shape this
 * version writes is dropped rather than repaired — a draft is a convenience,
 * and the route validates whatever survives.
 */
export function parseDraft(raw: string | null): ArrivageDraft | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data?.cart)) return null;

    const cart: CartLine[] = [];
    for (const line of data.cart) {
      const sizes = Array.isArray(line?.sizes)
        ? line.sizes.filter(
            (s: unknown): s is ArrivalSize =>
              typeof (s as { size?: unknown })?.size === "string" &&
              Number.isInteger((s as { quantity?: unknown })?.quantity) &&
              (s as { quantity: number }).quantity >= 1,
          )
        : [];
      const wellFormed =
        typeof line?.key === "string" &&
        (line.mode === "new" || line.mode === "existing") &&
        typeof line.modelId === "string" &&
        typeof line.modelName === "string" &&
        typeof line.color === "string" &&
        (line.mode === "new" || typeof line.shoeId === "string") &&
        sizes.length > 0;
      if (!wellFormed || cart.some((l) => l.key === line.key)) continue;
      cart.push({
        key: line.key,
        mode: line.mode,
        modelId: line.modelId,
        modelName: line.modelName,
        color: line.color,
        ...(line.mode === "existing" ? { shoeId: line.shoeId } : {}),
        sizes: sizes.map((s: ArrivalSize) => ({
          size: s.size,
          quantity: s.quantity,
        })),
      });
    }

    return {
      cart,
      reference: typeof data.reference === "string" ? data.reference : "",
      note: typeof data.note === "string" ? data.note : "",
    };
  } catch {
    return null;
  }
}
