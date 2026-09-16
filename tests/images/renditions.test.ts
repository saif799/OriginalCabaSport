import { describe, expect, it } from "vitest";
import { allRenditionKeys, buildSingleObjectKey } from "@/lib/images/renditions";

/**
 * What survived ADR-0008: key construction, and the delete rule.
 *
 * Renditions are no longer written — Vercel's optimizer resizes on read — but
 * the bucket still holds three objects for each of the 116 rows written while
 * ADR-0007 was in force, and only the `_800.webp` key of each is recorded. So
 * `allRenditionKeys` is the one piece of the convention that must stay exactly
 * right: it is what stops a delete leaking two orphans per row.
 *
 * It has to be total over three generations of key at once — the ~261 rows that
 * predate ADR-0007, the 116 written under it, and everything written since —
 * and the failure mode is silent, so that totality is what most of these
 * assertions are about.
 */

/** Rows from before ADR-0007: one object, original extension, no siblings. */
const LEGACY = [
  "products/shoes/7a55d06c/uuid-GIANNIS_IMMORTALITY_4_EP.avif",
  "products/shoes/7a55d06c/uuid-IMG_3586.jpeg",
  "products/shoes/7a55d06c/uuid-nike-kd-18.webp",
  "collections/abc/uuid-ja-morant-hero-dunk-2022.jpg",
  "products/shoes/7a55d06c/uuid-shoe.png",
];

describe("allRenditionKeys", () => {
  it("expands an ADR-0007 key into the three objects a delete has to remove", () => {
    expect(allRenditionKeys("products/shoes/abc/uuid-kd-18_800.webp")).toEqual([
      "products/shoes/abc/uuid-kd-18_400.webp",
      "products/shoes/abc/uuid-kd-18_800.webp",
      "products/shoes/abc/uuid-kd-18_1600.webp",
    ]);
  });

  it("returns a pre-ADR-0007 key unchanged, so delete still works on old rows", () => {
    for (const key of LEGACY) {
      expect(allRenditionKeys(key)).toEqual([key]);
    }
  });

  it("returns a key written since ADR-0008 unchanged", () => {
    const key = "products/shoes/abc/uuid-kd-18.webp";
    expect(allRenditionKeys(key)).toEqual([key]);
  });

  it("strips only the trailing suffix, so a name ending in _800 keeps it", () => {
    expect(allRenditionKeys("products/uuid-shoe_800_400.webp")).toEqual([
      "products/uuid-shoe_800_400.webp",
      "products/uuid-shoe_800_800.webp",
      "products/uuid-shoe_800_1600.webp",
    ]);
  });

  it("ignores a width that was never one of ours", () => {
    const key = "products/uuid-hand-optimised_1200.webp";
    expect(allRenditionKeys(key)).toEqual([key]);
  });

  it("ignores a rendition-looking name in a non-webp format", () => {
    const key = "products/uuid-shoe_800.jpg";
    expect(allRenditionKeys(key)).toEqual([key]);
  });
});

describe("buildSingleObjectKey", () => {
  it("keeps the extension, because the key names a real object", () => {
    const key = buildSingleObjectKey("products/shoes/abc", "kd-18.webp");
    expect(key).toMatch(/^products\/shoes\/abc\/[0-9a-f-]{36}-kd-18\.webp$/);
  });

  it("sanitises characters that have no business in a key", () => {
    const key = buildSingleObjectKey("products", "nike air max 90 (2024).png");
    expect(key).toMatch(/^products\/[0-9a-f-]{36}-nike_air_max_90__2024_\.png$/);
  });

  it("normalises stray slashes in the folder", () => {
    const key = buildSingleObjectKey("/products/shoes/", "shoe.webp");
    expect(key).toMatch(/^products\/shoes\/[0-9a-f-]{36}-shoe\.webp$/);
  });

  it("tolerates an empty folder", () => {
    expect(buildSingleObjectKey("", "shoe.webp")).toMatch(/^[0-9a-f-]{36}-shoe\.webp$/);
  });

  /**
   * A user file called `photo_800.webp` would otherwise produce a key that
   * `allRenditionKeys` reads as an ADR-0007 set, and its delete would issue two
   * requests for objects nobody wrote.
   */
  it("strips a trailing width that would mimic an ADR-0007 rendition", () => {
    const key = buildSingleObjectKey("products", "photo_800.webp");
    expect(key).toMatch(/^products\/[0-9a-f-]{36}-photo\.webp$/);
    expect(allRenditionKeys(key)).toEqual([key]);
  });

  it("keeps a trailing width that was never one of ours", () => {
    const key = buildSingleObjectKey("products", "photo_1200.webp");
    expect(key).toMatch(/-photo_1200\.webp$/);
    expect(allRenditionKeys(key)).toEqual([key]);
  });

  it("gives two uploads of the same filename different keys", () => {
    expect(buildSingleObjectKey("products", "shoe.webp")).not.toBe(
      buildSingleObjectKey("products", "shoe.webp"),
    );
  });
});
