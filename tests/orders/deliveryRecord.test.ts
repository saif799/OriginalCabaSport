import { describe, expect, it } from "vitest";

import { canonicalPhone, phoneKey } from "@/lib/orders/phone";
import { classifyRecord } from "@/lib/orders/deliveryRecord";

/**
 * Every "real row" case below was taken from the live orders table, not
 * invented: before `canonicalPhone` was applied on the write path, the admin
 * forms stored the phone exactly as it was typed, so separators, a stray
 * leading space and one `+213` number were all really in there.
 *
 * They are kept as test cases precisely because that data is now normalised —
 * these are the inputs the normalisation has to keep getting right, on the
 * write path and on any re-run of the backfill.
 */
describe("phoneKey", () => {
  it("leaves a clean mobile as its 9-digit core", () => {
    expect(phoneKey("0555605770")).toBe("555605770");
  });

  it("collapses every stored spelling of one number onto one key", () => {
    const key = "555605770";
    expect(phoneKey("0555605770")).toBe(key);
    expect(phoneKey("+213555605770")).toBe(key);
    expect(phoneKey("00213555605770")).toBe(key);
    expect(phoneKey("213555605770")).toBe(key);
    expect(phoneKey("0555 60 57 70")).toBe(key);
    expect(phoneKey(" 0555605770 ")).toBe(key);
    // Already the bare national core — an admin form accepts this shape.
    expect(phoneKey("555605770")).toBe(key);
  });

  it("strips the separators the admin forms let through", () => {
    expect(phoneKey("0770 205 202")).toBe("770205202");
    expect(phoneKey(" 0562 21 02 59")).toBe("562210259");
    expect(phoneKey("0559527433 ")).toBe("559527433");
    expect(phoneKey("0 559 07 60 51")).toBe("559076051");
    expect(phoneKey("05 42827199")).toBe("542827199");
    expect(phoneKey("054035 41 20")).toBe("540354120");
  });

  /**
   * The reason the country-code strip is length-guarded. An Algiers landline is
   * `021 XX XX XX`; dropping its leading zero leaves a number that *starts*
   * with 213 but is not carrying a country code. An unguarded strip would eat
   * six digits of a real phone number.
   */
  it("does not mistake an Algiers landline's 213 prefix for a country code", () => {
    expect(phoneKey("021 34 56 78")).toBe("21345678");
    expect(phoneKey("0213456789")).toBe("213456789");
    // ...and the same landline written internationally still lands on the
    // national form, because now the 213 really is a country code.
    expect(phoneKey("+21321345678")).toBe("21345678");
  });

  it("keeps a malformed number as its own key rather than dropping it", () => {
    // Two orders really carry this 9-digit typo. They should match each other
    // and nothing else — not the valid 10-digit number they resemble.
    expect(phoneKey("054048505")).toBe("54048505");
    expect(phoneKey("0540485052")).toBe("540485052");
    expect(phoneKey("054048505")).not.toBe(phoneKey("0540485052"));
    expect(phoneKey("067048001")).toBe("67048001");
  });

  it("reads Arabic-Indic digits, which the storefront keyboard can emit", () => {
    expect(phoneKey("٠٥٥٥٦٠٥٧٧٠")).toBe("555605770");
  });

  it("returns null when there is nothing numeric to key on", () => {
    expect(phoneKey("")).toBeNull();
    expect(phoneKey("   ")).toBeNull();
    expect(phoneKey("Ahmed Benali")).toBeNull();
    expect(phoneKey(null)).toBeNull();
    expect(phoneKey(undefined)).toBeNull();
    // A number that is nothing *but* a country code has no national part.
    expect(phoneKey("0")).toBeNull();
  });
});

describe("canonicalPhone", () => {
  it("is the form orders are stored and matched on", () => {
    // Equality on this string is the Delivery Record's whole notion of "the
    // same customer", so every spelling has to land on one value.
    for (const spelling of [
      "0555605770",
      "+213555605770",
      "00213555605770",
      "213555605770",
      "0555 60 57 70",
      " 0555605770 ",
      "555605770",
      "٠٥٥٥٦٠٥٧٧٠",
    ]) {
      expect(canonicalPhone(spelling)).toBe("0555605770");
    }
  });

  it("keeps the leading zero, because that is what a human and a courier read", () => {
    // The bare 9-digit core is the match key, not a phone number anyone in
    // Algeria would recognise — and this column is displayed and dialled.
    expect(canonicalPhone("555605770")).not.toBe("555605770");
    expect(canonicalPhone("555605770")).toBe("0555605770");
  });

  it("is idempotent, which is what makes the backfill re-runnable", () => {
    for (const raw of ["0555605770", "+213555605770", "021 34 56 78", "067048001"]) {
      const once = canonicalPhone(raw)!;
      expect(canonicalPhone(once)).toBe(once);
    }
  });

  it("leaves a malformed number alone rather than inventing digits", () => {
    // Both really exist in the orders table. Rewriting them into a valid-looking
    // number would silently attach one customer's history to another.
    expect(canonicalPhone("067048001")).toBe("067048001");
    expect(canonicalPhone("054048505")).toBe("054048505");
    expect(canonicalPhone("021 34 56 78")).toBe("021345678");
  });

  it("returns null when there is nothing numeric, so callers keep the original", () => {
    expect(canonicalPhone("")).toBeNull();
    expect(canonicalPhone("Ahmed Benali")).toBeNull();
    expect(canonicalPhone(null)).toBeNull();
    expect(canonicalPhone(undefined)).toBeNull();
  });
});

describe("classifyRecord", () => {
  it("is unknown when nothing has resolved", () => {
    // Also the shape of a customer whose only past orders were cancelled or
    // are still in flight: neither reaches these counters at all.
    expect(classifyRecord(0, 0)).toBe("unknown");
  });

  it("is clean when more parcels landed than came back", () => {
    expect(classifyRecord(1, 0)).toBe("clean");
    expect(classifyRecord(4, 0)).toBe("clean");
    expect(classifyRecord(3, 1)).toBe("clean");
  });

  it("is mixed on a tie, but only a tie with something in it", () => {
    expect(classifyRecord(1, 1)).toBe("mixed");
    expect(classifyRecord(5, 5)).toBe("mixed");
  });

  it("is poor when more came back than landed", () => {
    expect(classifyRecord(0, 1)).toBe("poor");
    expect(classifyRecord(1, 2)).toBe("poor");
  });

  it("resolves the ladder top-down, so poor beats every weaker verdict", () => {
    // The three rules overlap by design; order is what makes them a decision.
    expect(classifyRecord(0, 3)).toBe("poor");
  });
});
