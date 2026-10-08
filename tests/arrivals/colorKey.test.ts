import { describe, expect, it } from "vitest";
import { cleanColorName, colorKey } from "@/lib/arrivals/colorKey";

describe("colorKey", () => {
  it("treats names that differ only by case as the same colour", () => {
    expect(colorKey("Triple Black")).toBe(colorKey("triple BLACK"));
  });

  it("ignores surrounding whitespace", () => {
    expect(colorKey("  Red ")).toBe(colorKey("Red"));
  });

  it("ignores repeated whitespace inside the name", () => {
    expect(colorKey("ice  /   full\tBlack")).toBe(colorKey("ice / full Black"));
  });

  it("keeps genuinely different colours apart", () => {
    expect(colorKey("Red")).not.toBe(colorKey("Dark Red"));
    expect(colorKey("Blackwhite")).not.toBe(colorKey("Black white"));
  });

  it("is empty for a name with nothing in it", () => {
    expect(colorKey("   ")).toBe("");
  });
});

describe("cleanColorName", () => {
  it("tidies the whitespace and leaves the owner's capitalisation alone", () => {
    expect(cleanColorName("  ice   Blue ")).toBe("ice Blue");
  });
});
