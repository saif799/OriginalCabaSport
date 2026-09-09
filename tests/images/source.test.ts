import { describe, expect, it } from "vitest";
import {
  ALREADY_SMALL_BYTES,
  QUALITY_BUDGET_BYTES,
  isAlreadySmall,
  reusesSourceAt,
  triesLosslessEncode,
  withinQualityBudget,
} from "@/lib/images/source";

/**
 * The "leave it alone" rule. ADR-0007 already applies it to the backfill — rows
 * under 300 KB are not re-encoded, because a generation of quality is spent for
 * no bytes saved. These pin the same judgement on the upload path, where it is
 * split in two: what the source bytes *may* be reused for (sameness, here), and
 * whether that costs too much (measured against the encode, in transform.ts).
 */

describe("isAlreadySmall", () => {
  it("uses the 300 KB line the backfill selects on", () => {
    expect(ALREADY_SMALL_BYTES).toBe(300 * 1024);
  });

  it("is inclusive at the line", () => {
    expect(isAlreadySmall(ALREADY_SMALL_BYTES)).toBe(true);
    expect(isAlreadySmall(ALREADY_SMALL_BYTES + 1)).toBe(false);
  });

  it("holds for the hand-optimised 30-50 KB uploads", () => {
    expect(isAlreadySmall(42 * 1024)).toBe(true);
  });

  it("does not hold for a camera photo", () => {
    expect(isAlreadySmall(3.8 * 1024 * 1024)).toBe(false);
  });
});

describe("reusesSourceAt", () => {
  const source = { bytes: 40 * 1024, width: 600, format: "webp" };

  it("reuses at every width that would not resize the source", () => {
    expect(reusesSourceAt(source, 800)).toBe(true);
    expect(reusesSourceAt(source, 1600)).toBe(true);
  });

  it("reuses at the source's own width", () => {
    expect(reusesSourceAt({ ...source, width: 800 }, 800)).toBe(true);
  });

  it("encodes where the source is genuinely downsized", () => {
    expect(reusesSourceAt(source, 400)).toBe(false);
  });

  it("encodes anything that is not already webp — the key must hold webp bytes", () => {
    for (const format of ["jpeg", "png", "avif", undefined]) {
      expect(reusesSourceAt({ ...source, format }, 1600)).toBe(false);
    }
  });

  it("encodes when sharp could not read the width", () => {
    // 0 is "unknown", and unknown must never be read as "fits".
    expect(reusesSourceAt({ ...source, width: 0 }, 1600)).toBe(false);
  });

  it("says nothing about size — that is the budget's call, on a measured encode", () => {
    expect(reusesSourceAt({ ...source, bytes: 4 * 1024 * 1024 }, 1600)).toBe(true);
  });

  describe("EXIF orientation", () => {
    it("reuses a source with no rotation to apply", () => {
      expect(reusesSourceAt({ ...source, orientation: 1 }, 1600)).toBe(true);
    });

    it("encodes anything that still has a rotation to bake in", () => {
      // Reused bytes skip `.rotate()`, so this would be stored sideways.
      for (const orientation of [2, 3, 4, 5, 6, 7, 8]) {
        expect(reusesSourceAt({ ...source, orientation }, 1600)).toBe(false);
      }
    });
  });

  describe("animation", () => {
    it("reuses a single-page source", () => {
      expect(reusesSourceAt({ ...source, pages: 1 }, 1600)).toBe(true);
    });

    it("encodes an animated source", () => {
      // Reused at 800/1600 and flattened by sharp at 400, one image would
      // animate or not depending on the viewport. ADR-0007 dropped gif over the
      // same flattening; webp is made to match it, not to be the exception.
      expect(reusesSourceAt({ ...source, pages: 12 }, 1600)).toBe(false);
    });
  });
});

describe("triesLosslessEncode", () => {
  it("holds for an already-small png — the one lossless source we accept", () => {
    expect(triesLosslessEncode({ bytes: 40 * 1024, width: 600, format: "png" })).toBe(true);
  });

  it("does not hold for a png large enough that lossless would cost real time", () => {
    expect(triesLosslessEncode({ bytes: 900 * 1024, width: 4032, format: "png" })).toBe(false);
  });

  it("does not hold for a source whose generation is already spent", () => {
    for (const format of ["jpeg", "webp", "avif", undefined]) {
      expect(triesLosslessEncode({ bytes: 40 * 1024, width: 600, format })).toBe(false);
    }
  });
});

describe("withinQualityBudget", () => {
  const kb = (n: number) => n * 1024;

  it("spends up to 50 KB to keep an upload's quality", () => {
    expect(QUALITY_BUDGET_BYTES).toBe(50 * 1024);
    expect(withinQualityBudget(kb(90), kb(40))).toBe(true);
    expect(withinQualityBudget(kb(90) + 1, kb(40))).toBe(false);
  });

  it("keeps a hand-optimised upload rather than shave a few KB off it", () => {
    expect(withinQualityBudget(kb(42), kb(30))).toBe(true);
  });

  it("takes the encode when it saves bytes a phone would feel", () => {
    // The case that made the byte-ceiling rule wrong: 271 KB in, 193 KB out.
    expect(withinQualityBudget(kb(271), kb(193))).toBe(false);
  });

  it("takes anything smaller than the encode", () => {
    expect(withinQualityBudget(kb(10), kb(30))).toBe(true);
  });
});
