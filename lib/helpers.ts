/**
 * Resolves the final display price for a specific shoe size variant.
 *
 * Priority: size-specific priceOverride -> shoe (colour) priceOverride -> model basePrice
 */
export function resolveProductPrice(
  modelBasePrice: number,
  shoePriceOverride: number | null | undefined,
  sizePriceOverride: number | null | undefined,
): number {
  if (sizePriceOverride != null) return sizePriceOverride;
  if (shoePriceOverride != null) return shoePriceOverride;
  return modelBasePrice;
}

/**
 * Resolves the compare-at ("original") price used for strikethrough display.
 *
 * Priority: shoe (colour) compareAtPriceOverride -> model compareAtPrice.
 * Null means no strikethrough should be shown.
 */
export function resolveCompareAtPrice(
  modelCompareAt: number | null,
  shoeCompareAtOverride: number | null | undefined,
): number | null {
  if (shoeCompareAtOverride != null) return shoeCompareAtOverride;
  return modelCompareAt;
}

export type ProductWithPriceAndSizes = {
  price: number;
  sizes: Array<{
    size: string;
    quantity: number;
    resolvedPrice: number;
  }>;
};

/**
 * Resolves the storefront display price for a product based on active size filter(s).
 *
 * Rules:
 * 1. If no size filter is active (i.e. no sizes selected in filter or search params),
 *    size-level override prices are NOT shown. Return the product's regular
 *    price (`product.price`, resolved from model basePrice and shoe priceOverride).
 * 2. If size filter(s) are active, show the override/resolved price for the selected size(s).
 * 3. If multiple filtered sizes match this product and have different prices (collision),
 *    always show the higher price (`Math.max`).
 * 4. If none of the selected sizes exist in this product, fall back to `product.price`.
 */
export function getEffectiveProductPrice(
  product: ProductWithPriceAndSizes,
  selectedSizes?: (number | string)[] | null,
): number {
  if (!selectedSizes || selectedSizes.length === 0) {
    return product.price;
  }

  const selectedSet = new Set(selectedSizes.map(String));

  // Prefer in-stock matching sizes, falling back to matching sizes if all are zero stock
  const inStockMatching = product.sizes.filter(
    (s) => s.quantity > 0 && selectedSet.has(String(s.size)),
  );
  const matching = inStockMatching.length > 0
    ? inStockMatching
    : product.sizes.filter((s) => selectedSet.has(String(s.size)));

  if (matching.length === 0) {
    return product.price;
  }

  return Math.max(...matching.map((s) => s.resolvedPrice));
}
