import { normalizeDigits } from "@/lib/format";

/**
 * Customer phone numbers, reduced to a canonical stored form and a comparable
 * key.
 *
 * Orders are stored with `canonicalPhone` applied (see `lib/orders/placeOrder`),
 * so `orders.telephone` is a plain `0XXXXXXXXX` string and equality on it is a
 * usable notion of "the same customer". That is what lets the Delivery Record
 * look history up with an indexed `IN` rather than normalising a whole table.
 *
 * It was not always so: only the storefront checkout ever validated the shape,
 * while both admin forms stored whatever was typed — the table held
 * `"0770 205 202"`, `" 0562 21 02 59"`, `"0559527433 "` and `"+213555605770"`.
 * Those rows were rewritten once by `lib/scripts/normalizeOrderPhones.ts`. Run
 * it again if a write path is ever added that bypasses `canonicalPhone`.
 */

/** Digits only, with Arabic-Indic numerals folded onto ASCII first. */
function digitsOf(raw: string): string {
  return normalizeDigits(raw).replace(/\D/g, "");
}

/**
 * The national core of an Algerian number — 9 digits for a mobile, 8 for a
 * landline — or null if there is nothing numeric to key on.
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
 * The form a phone number is stored and displayed in: the national core with
 * its leading zero back on. `+213 555 60 57 70` and `0555 60 57 70` both become
 * `0555605770`.
 *
 * The leading zero is kept rather than storing the bare core, because this
 * string is also what a human reads in the orders table and what the courier is
 * handed — `555605770` is not a phone number anyone in Algeria would recognise.
 *
 * Idempotent: applying it to an already-canonical number returns it unchanged,
 * which is what makes it safe on both the write path and a re-run of the
 * backfill. Returns null only when there was nothing numeric to work with, and
 * callers keep the original in that case rather than storing nothing.
 */
export function canonicalPhone(raw: string | null | undefined): string | null {
  const key = phoneKey(raw);
  return key === null ? null : `0${key}`;
}
