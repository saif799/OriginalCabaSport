import { describe, expect, it } from "vitest";
import { ALREADY_SMALL_BYTES, isAlreadySmall } from "@/lib/images/source";

/**
 * The "leave it alone" rule, and all that is left of it after ADR-0008.
 *
 * It now governs one decision only: whether the browser re-encodes before
 * uploading (lib/images/downscale.ts). Below the line a downscale spends a
 * generation of quality to save upstream bytes nobody would notice. What a
 * customer is finally served is decided by Vercel's optimizer at read time and
 * is not this module's business any more.
 */

describe("isAlreadySmall", () => {
  it("uses the 300 KB line between hand-optimised and camera files", () => {
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
