import { describe, expect, it } from "vitest";
import {
  RENDITION_WIDTHS,
  DEFAULT_RENDITION_WIDTH,
  isRenditionRef,
  renditionBase,
  renditionRef,
  allRenditionKeys,
  withRenditionWidth,
  nearestRenditionWidth,
  buildRenditionBaseKey,
  buildSingleObjectKey,
} from "@/lib/images/renditions";

/**
 * The key convention from ADR-0007, and the loader rule built on it.
 *
 * This is the whole safety net for the ~327 gallery rows that predate the
 * decision: they have no renditions, so every function here must leave them
 * exactly as it found them. A regression is a 404 in a social preview or a
 * catalog card, with nothing thrown anywhere.
 */

const LEGACY = [
  "products/shoes/7a55d06c/uuid-GIANNIS_IMMORTALITY_4_EP.avif",
  "products/shoes/7a55d06c/uuid-IMG_3586.jpeg",
  "products/shoes/7a55d06c/uuid-nike-kd-18.webp",
  "collections/abc/uuid-ja-morant-hero-dunk-2022.jpg",
  "products/shoes/7a55d06c/uuid-shoe.png",
];

describe("rendition widths", () => {
  it("is the frozen set from ADR-0007", () => {
    expect(RENDITION_WIDTHS).toEqual([400, 800, 1600]);
  });

  it("defaults to the width stored in shoe_images.url", () => {
    expect(DEFAULT_RENDITION_WIDTH).toBe(800);
    expect(RENDITION_WIDTHS).toContain(DEFAULT_RENDITION_WIDTH);
  });
});

describe("isRenditionRef", () => {
  it("recognises a rendition key", () => {
    expect(isRenditionRef("products/shoes/a/uuid-name_800.webp")).toBe(true);
    expect(isRenditionRef("products/shoes/a/uuid-name_400.webp")).toBe(true);
    expect(isRenditionRef("products/shoes/a/uuid-name_1600.webp")).toBe(true);
  });

  it("recognises a rendition public URL, not just a key", () => {
    expect(isRenditionRef("https://pub-x.r2.dev/products/a/uuid-name_800.webp")).toBe(true);
  });

  it.each(LEGACY)("leaves the legacy key %s alone", (key) => {
    expect(isRenditionRef(key)).toBe(false);
  });

  it("rejects a width that is not in the set", () => {
    // 43 existing rows end in _<digits>.webp from hand-optimising. Only the
    // three widths we actually write may be rewritten.
    expect(isRenditionRef("products/shoes/a/uuid-name_1000.webp")).toBe(false);
    expect(isRenditionRef("products/shoes/a/uuid-name_640.webp")).toBe(false);
  });

  it("rejects a rendition-looking name in a non-webp format", () => {
    expect(isRenditionRef("products/shoes/a/uuid-name_800.jpeg")).toBe(false);
  });
});

describe("renditionBase", () => {
  it("strips the width suffix", () => {
    expect(renditionBase("products/shoes/a/uuid-name_800.webp")).toBe(
      "products/shoes/a/uuid-name",
    );
  });

  it("strips only the trailing suffix, so a filename ending in _800 survives", () => {
    // Upload of "shoe_800.webp" -> base "uuid-shoe_800" -> "uuid-shoe_800_400.webp".
    expect(renditionBase("products/shoes/a/uuid-shoe_800_400.webp")).toBe(
      "products/shoes/a/uuid-shoe_800",
    );
  });

  it("returns null for anything that is not a rendition", () => {
    for (const key of LEGACY) expect(renditionBase(key)).toBeNull();
  });
});

describe("renditionRef / allRenditionKeys", () => {
  it("round-trips base -> rendition -> base", () => {
    const base = "products/shoes/a/uuid-name";
    for (const w of RENDITION_WIDTHS) {
      expect(renditionBase(renditionRef(base, w))).toBe(base);
    }
  });

  it("names the file after the width", () => {
    expect(renditionRef("products/shoes/a/uuid-name", 400)).toBe(
      "products/shoes/a/uuid-name_400.webp",
    );
  });

  it("lists every key a delete has to remove", () => {
    expect(allRenditionKeys("products/shoes/a/uuid-name_800.webp")).toEqual([
      "products/shoes/a/uuid-name_400.webp",
      "products/shoes/a/uuid-name_800.webp",
      "products/shoes/a/uuid-name_1600.webp",
    ]);
  });

  it("returns the single legacy key unchanged, so delete still works on old rows", () => {
    expect(allRenditionKeys("products/shoes/a/uuid-IMG_3586.jpeg")).toEqual([
      "products/shoes/a/uuid-IMG_3586.jpeg",
    ]);
  });
});

describe("nearestRenditionWidth", () => {
  it("rounds up to the smallest rendition that covers the request", () => {
    expect(nearestRenditionWidth(1)).toBe(400);
    expect(nearestRenditionWidth(400)).toBe(400);
    expect(nearestRenditionWidth(401)).toBe(800);
    expect(nearestRenditionWidth(800)).toBe(800);
    expect(nearestRenditionWidth(1200)).toBe(1600);
  });

  it("clamps above the largest rendition rather than inventing one", () => {
    expect(nearestRenditionWidth(1601)).toBe(1600);
    expect(nearestRenditionWidth(3840)).toBe(1600);
  });
});

describe("withRenditionWidth (the next/image loader rule)", () => {
  const url = "https://pub-x.r2.dev/products/shoes/a/uuid-name_800.webp";

  it("swaps the width on a rendition URL", () => {
    expect(withRenditionWidth(url, 400)).toBe(
      "https://pub-x.r2.dev/products/shoes/a/uuid-name_400.webp",
    );
    expect(withRenditionWidth(url, 1600)).toBe(
      "https://pub-x.r2.dev/products/shoes/a/uuid-name_1600.webp",
    );
  });

  it("snaps a requested width to the nearest stored rendition", () => {
    expect(withRenditionWidth(url, 640)).toBe(
      "https://pub-x.r2.dev/products/shoes/a/uuid-name_800.webp",
    );
    expect(withRenditionWidth(url, 3840)).toBe(
      "https://pub-x.r2.dev/products/shoes/a/uuid-name_1600.webp",
    );
  });

  it.each(LEGACY)("passes the legacy URL for %s straight through", (key) => {
    const legacyUrl = `https://pub-x.r2.dev/${key}`;
    for (const w of [400, 640, 1080, 3840]) {
      expect(withRenditionWidth(legacyUrl, w)).toBe(legacyUrl);
    }
  });

  it("passes through anything that is not an R2 image at all", () => {
    expect(withRenditionWidth("/placeholder.svg", 800)).toBe("/placeholder.svg");
    expect(withRenditionWidth("", 800)).toBe("");
  });

  it("preserves a query string on a rendition URL", () => {
    expect(withRenditionWidth(`${url}?v=2`, 400)).toBe(
      "https://pub-x.r2.dev/products/shoes/a/uuid-name_400.webp?v=2",
    );
  });
});

describe("buildRenditionBaseKey", () => {
  it("drops the source extension, because the base key is not a file", () => {
    const key = buildRenditionBaseKey("products/shoes/abc", "IMG_3586.jpeg");
    expect(key).toMatch(/^products\/shoes\/abc\/[0-9a-f-]{36}-IMG_3586$/);
    expect(key.endsWith(".jpeg")).toBe(false);
  });

  it("sanitises the filename the same way the old upload path did", () => {
    const key = buildRenditionBaseKey("uploads", "Nike Air (2024)!.PNG");
    expect(key).toMatch(/^uploads\/[0-9a-f-]{36}-Nike_Air__2024__$/);
  });

  it("normalises stray slashes in the folder", () => {
    expect(buildRenditionBaseKey("/uploads/", "a.jpg")).toMatch(/^uploads\/[0-9a-f-]{36}-a$/);
    expect(buildRenditionBaseKey("", "a.jpg")).toMatch(/^[0-9a-f-]{36}-a$/);
  });

  it("produces a base whose renditions are recognised as renditions", () => {
    const base = buildRenditionBaseKey("products/shoes/abc", "photo.jpg");
    expect(isRenditionRef(renditionRef(base, DEFAULT_RENDITION_WIDTH))).toBe(true);
  });
});

describe("buildSingleObjectKey (the presigned fallback)", () => {
  it("keeps the extension, because this one really is a file", () => {
    expect(buildSingleObjectKey("uploads", "IMG_3586.jpeg")).toMatch(
      /^uploads\/[0-9a-f-]{36}-IMG_3586\.jpeg$/,
    );
  });

  it("stores an untransformed original the loader will pass through", () => {
    expect(isRenditionRef(buildSingleObjectKey("uploads", "photo.jpg"))).toBe(false);
  });
});

describe("a user filename that mimics a rendition", () => {
  // The fallback path uploads whatever the user picked. Without stripping the
  // width, "photo_800.webp" becomes "<uuid>-photo_800.webp", which the loader
  // would rewrite to "<uuid>-photo_400.webp" — an object nobody ever wrote.
  it.each(["photo_400.webp", "photo_800.webp", "photo_1600.webp"])(
    "cannot produce a rendition-looking single-object key from %s",
    (filename) => {
      expect(isRenditionRef(buildSingleObjectKey("uploads", filename))).toBe(false);
    },
  );

  it("keeps a width that is not one of ours, since the loader ignores it anyway", () => {
    expect(buildSingleObjectKey("uploads", "photo_1000.webp")).toMatch(/-photo_1000\.webp$/);
  });

  it("strips the width from a rendition base too, so the set stays unambiguous", () => {
    const base = buildRenditionBaseKey("uploads", "photo_800.webp");
    expect(base).toMatch(/-photo$/);
    expect(renditionBase(renditionRef(base, 400))).toBe(base);
  });
});
