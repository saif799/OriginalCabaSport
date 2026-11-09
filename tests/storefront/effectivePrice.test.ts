import { describe, expect, it } from "vitest";
import { getEffectiveProductPrice, type ProductWithPriceAndSizes } from "@/lib/helpers";

describe("getEffectiveProductPrice", () => {
  // Product with base price 20,000 DZD, 5 sizes: 4 sizes at 20,000 and 1 size (40) at 17,000 override
  const sampleProduct: ProductWithPriceAndSizes = {
    price: 20000,
    sizes: [
      { size: "40", quantity: 2, resolvedPrice: 17000 },
      { size: "41", quantity: 3, resolvedPrice: 20000 },
      { size: "42", quantity: 5, resolvedPrice: 20000 },
      { size: "43", quantity: 1, resolvedPrice: 20000 },
      { size: "44", quantity: 4, resolvedPrice: 20000 },
    ],
  };

  it("shows standard product price when no size filter is active", () => {
    // When no size filter is active, override price (17,000) must NOT be shown
    expect(getEffectiveProductPrice(sampleProduct, [])).toBe(20000);
    expect(getEffectiveProductPrice(sampleProduct, undefined)).toBe(20000);
    expect(getEffectiveProductPrice(sampleProduct, null)).toBe(20000);
  });

  it("shows the override price when that size is selected on a filter", () => {
    // Filter selecting size 40 (which has override 17,000)
    expect(getEffectiveProductPrice(sampleProduct, [40])).toBe(17000);
    expect(getEffectiveProductPrice(sampleProduct, ["40"])).toBe(17000);
  });

  it("shows standard price when a non-override size is selected", () => {
    expect(getEffectiveProductPrice(sampleProduct, [41])).toBe(20000);
    expect(getEffectiveProductPrice(sampleProduct, [42])).toBe(20000);
  });

  it("always shows the higher price on collision when multiple sizes are selected", () => {
    // Collision between size 40 (17,000) and size 41 (20,000) -> 20,000
    expect(getEffectiveProductPrice(sampleProduct, [40, 41])).toBe(20000);
    expect(getEffectiveProductPrice(sampleProduct, ["40", "41", "42"])).toBe(20000);
  });

  it("resolves collision between multiple sizes with different overrides to the higher price", () => {
    const multiOverrideProduct: ProductWithPriceAndSizes = {
      price: 20000,
      sizes: [
        { size: "39", quantity: 1, resolvedPrice: 16000 },
        { size: "40", quantity: 2, resolvedPrice: 17000 },
        { size: "41", quantity: 3, resolvedPrice: 19000 },
        { size: "42", quantity: 4, resolvedPrice: 20000 },
        { size: "45", quantity: 1, resolvedPrice: 23000 },
      ],
    };

    // Collision between 16,000 and 17,000 -> 17,000
    expect(getEffectiveProductPrice(multiOverrideProduct, [39, 40])).toBe(17000);
    // Collision between 17,000 and 19,000 -> 19,000
    expect(getEffectiveProductPrice(multiOverrideProduct, [40, 41])).toBe(19000);
    // Collision between 17,000 and 23,000 -> 23,000
    expect(getEffectiveProductPrice(multiOverrideProduct, [40, 45])).toBe(23000);
  });

  it("shows higher override price only if selected on filter", () => {
    const higherOverrideProduct: ProductWithPriceAndSizes = {
      price: 20000,
      sizes: [
        { size: "42", quantity: 2, resolvedPrice: 20000 },
        { size: "45", quantity: 1, resolvedPrice: 25000 },
      ],
    };

    // No filter -> 20,000
    expect(getEffectiveProductPrice(higherOverrideProduct, [])).toBe(20000);
    // Filter [45] -> 25,000
    expect(getEffectiveProductPrice(higherOverrideProduct, [45])).toBe(25000);
    // Collision [42, 45] -> 25,000
    expect(getEffectiveProductPrice(higherOverrideProduct, [42, 45])).toBe(25000);
  });

  it("falls back to product price if none of the filtered sizes exist in the product", () => {
    expect(getEffectiveProductPrice(sampleProduct, [36, 37])).toBe(20000);
  });

  it("prefers in-stock sizes over out-of-stock sizes on collision", () => {
    const stockProduct: ProductWithPriceAndSizes = {
      price: 20000,
      sizes: [
        { size: "40", quantity: 0, resolvedPrice: 25000 }, // out of stock
        { size: "41", quantity: 2, resolvedPrice: 18000 }, // in stock
      ],
    };

    // When both are selected, since size 40 is out of stock (quantity 0), the available size 41 wins
    expect(getEffectiveProductPrice(stockProduct, [40, 41])).toBe(18000);
  });

  it("falls back to matching sizes if all selected sizes are out of stock", () => {
    const stockProduct: ProductWithPriceAndSizes = {
      price: 20000,
      sizes: [
        { size: "40", quantity: 0, resolvedPrice: 17000 },
        { size: "41", quantity: 0, resolvedPrice: 19000 },
      ],
    };

    expect(getEffectiveProductPrice(stockProduct, [40, 41])).toBe(19000);
  });
});
