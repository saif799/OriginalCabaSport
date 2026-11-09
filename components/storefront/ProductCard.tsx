"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ProductMedia from "./ProductMedia";
import ProductPrice from "./ProductPrice";
import { cn } from "@/lib/utils";
import type { StorefrontProduct } from "@/lib/storefront/products";
import { useLocalePath, useT } from "@/app/i18n/client";
import Ltr from "@/components/storefront/Ltr";
import { getEffectiveProductPrice } from "@/lib/helpers";

/** Cards are narrow (2 columns on mobile), so the run of sizes is capped and
 *  the remainder collapses into a "+N" — never a second wrapped line. */
const MAX_VISIBLE_SIZES = 5;

/**
 * Design system §5. No border, no shadow, no background, no radius — a square
 * image that zooms on hover, then a four-line text block:
 *
 *   1. variant — text-sm, muted, ALWAYS UPPERCASE
 *   2. title   — font-medium, steps up once at md:
 *   3. price   — font-medium, accent Pine, suffixed " DA"
 *   4. sizes   — in-stock pointures as muted, non-interactive chips
 *
 * The size line borrows the `.sf-chip` geometry (4px radius, 1px token
 * hairline) at a smaller scale rather than the recipe itself: these are
 * inert labels inside a link, not buttons, so they never take the ink fill
 * or the hover surface that would suggest they can be picked here.
 */
export default function ProductCard({
  product,
  className,
  priority = false,
  selectedSizes,
}: {
  product: StorefrontProduct;
  className?: string;
  priority?: boolean;
  selectedSizes?: (number | string)[];
}) {
  const { t } = useT("catalog");
  const localeHref = useLocalePath();
  const searchParams = useSearchParams();

  const activeSizes = useMemo(() => {
    if (selectedSizes !== undefined) return selectedSizes;
    const fromQuery = searchParams.get("sizes");
    if (!fromQuery) return [];
    return fromQuery
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }, [selectedSizes, searchParams]);

  const displayPrice = useMemo(
    () => getEffectiveProductPrice(product, activeSizes),
    [product, activeSizes],
  );

  const inStockSizes = product.sizes
    .filter((s) => s.quantity > 0)
    .sort((a, b) => Number(a.size) - Number(b.size));
  const visibleSizes = inStockSizes.slice(0, MAX_VISIBLE_SIZES);
  const hiddenSizeCount = inStockSizes.length - visibleSizes.length;

  return (
    <Link
      href={localeHref(`/product/${product.shoeId}`)}
      className={cn("group flex min-w-44 flex-col gap-4 py-2", className)}
    >
      <ProductMedia
        imageUrl={product.primaryImageUrl}
        imageAlt={
          product.primaryImageAlt ??
          // Falls back to a descriptive phrase, not just the name: alt text
          // is the only textual signal an image search has to go on.
          t("card.altFallback", {
            model: product.modelName,
            color: product.color,
          })
        }
        label={`${product.modelName} ${product.color}`}
        priority={priority}
        zoomOnHover
      />

      <div className="flex flex-col gap-2">
        <p className="sf-body text-xs font-normal uppercase tracking-[0.12em] text-(--sf-muted)">
          {product.color.toUpperCase()}
        </p>
        <h3 className="sf-heading text-base font-medium leading-snug tracking-[-0.01em] text-wrap text-(--sf-text) md:text-xl">
          {product.modelName}
        </h3>
        <ProductPrice
          price={displayPrice}
          compareAtPrice={product.compareAtPrice}
          size="sm"
        />

        {inStockSizes.length > 0 ? (
          <ul
            className="flex flex-nowrap items-center gap-1 overflow-hidden"
            aria-label={t("card.sizesLabel", {
              sizes: inStockSizes.map((s) => s.size).join(", "),
            })}
          >
            {visibleSizes.map((s) => (
              <li
                key={s.inventoryId}
                aria-hidden
                className="sf-body flex h-6 min-w-6 shrink-0 items-center justify-center rounded-(--sf-radius-sm) border border-(--sf-line) px-1 text-[11px] font-normal leading-none text-(--sf-muted)"
              >
                <Ltr>{s.size}</Ltr>
              </li>
            ))}
            {hiddenSizeCount > 0 && (
              <li
                aria-hidden
                className="sf-body flex h-6 shrink-0 items-center text-[11px] font-normal leading-none text-(--sf-muted)"
              >
                <Ltr>+{hiddenSizeCount}</Ltr>
              </li>
            )}
          </ul>
        ) : (
          <p className="sf-body text-[11px] font-normal uppercase tracking-[0.12em] text-(--sf-muted)">
            {t("card.soldOut")}
          </p>
        )}
      </div>
    </Link>
  );
}
