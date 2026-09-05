import { sql, type SQL } from "drizzle-orm";

import { normalizeDigits } from "@/lib/format";

/**
 * Customer phone numbers, reduced to a comparable key.
 *
 * `orders.telephone` is stored exactly as it was typed. Only the storefront
 * checkout validates the shape (`0[5-7]\d{8}`); both admin forms store the raw
 * string — `components/sendShoeOrder.tsx` strips separators to *validate* and
 * then saves the untouched input, and `components/multipleItemsOrder.tsx`
 * validates nothing at all. The table really holds `"0770 205 202"`,
 * `" 0562 21 02 59"`, `"0559527433 "` and `"+213555605770"`, so string equality
 * is not a usable notion of "the same customer".
 *
 * There is deliberately no normalisation on the write path: the phone is what
 * the courier calls, and rewriting stored order rows is a bigger decision than
 * this. Both readers that care normalise instead — see `phoneKeySql` for the
 * SQL mirror of this function.
 */

/** Digits only, with Arabic-Indic numerals folded onto ASCII first. */
function digitsOf(raw: string): string {
  return normalizeDigits(raw).replace(/\D/g, "");
}

/**
 * The national 9-digit core of an Algerian number, or null if there is nothing
 * numeric to key on.
 *
 * The order of the three strips is load-bearing. An Algiers landline is
 * `021 XX XX XX`, so once its leading zero is gone it *starts* with 213 while
 * carrying no country code at all — an unguarded country-code strip would eat
 * six digits of a real number. Hence: the `213` only comes off a string long
 * enough to still hold a full national number underneath it (>= 11 digits).
 *
 *   +213555605770 -> 555605770        0555 60 57 70 -> 555605770
 *   021 34 56 78  ->  21345678        555605770     -> 555605770
 *
 * Malformed numbers keep a key rather than being discarded: two orders carry
 * the same 9-digit typo, and they are almost certainly the same person.
 */
export function phoneKey(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let digits = digitsOf(raw);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length >= 11 && digits.startsWith("213")) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);

  return digits.length > 0 ? digits : null;
}

/**
 * The SQL mirror of `phoneKey`, for the one caller that cannot normalise in
 * TypeScript: the orders search box filters and paginates in the database, so
 * the stored column has to be normalised there.
 *
 * This is the only place the rule is duplicated, and it is the cheap side of
 * the duplication on purpose — the Delivery Record, which decides whether a
 * parcel gets sent, counts in TypeScript against `phoneKey` alone. If these two
 * ever drift, search misses a row; nothing renders the wrong colour.
 *
 * Keep the four steps below in the same order as `phoneKey`, for the same
 * reason (see its comment on the Algiers landline).
 */
export function phoneKeySql(column: SQL | SQL.Aliased | unknown): SQL<string> {
  const digits = sql`regexp_replace(${column}, '[^0-9]', '', 'g')`;
  const noIntlPrefix = sql`regexp_replace(${digits}, '^00', '')`;
  const noCountryCode = sql`
    CASE
      WHEN length(${noIntlPrefix}) >= 11 AND ${noIntlPrefix} LIKE '213%'
        THEN substring(${noIntlPrefix} from 4)
      ELSE ${noIntlPrefix}
    END`;
  return sql<string>`regexp_replace(${noCountryCode}, '^0', '')`;
}
