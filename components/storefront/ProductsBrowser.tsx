"use client";

import { useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import FilterTool, { type FilterParams } from "@/components/filterTool";
import ProductCard from "./ProductCard";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { SlidersHorizontal, ArrowDownUp, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StorefrontProduct } from "@/lib/storefront/products";
import { getEffectiveProductPrice } from "@/lib/helpers";
import { useT } from "@/app/i18n/client";

type SortOption = "nouveautes" | "prix-asc" | "prix-desc";



/**
 * Design system §3.3 — a filter rail plus a 2/3-column product grid that
 * collapses to a bottom drawer on mobile, under a sticky sub-header that sits
 * below the fixed nav.
 */
export default function ProductsBrowser({
  initialProducts,
  models,
  sizes,
}: {
  initialProducts: StorefrontProduct[];
  models: string[];
  sizes: number[];
}) {
  const { t } = useT("catalog");
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const [filterParams, setFilterParams] = useState<FilterParams>({
    models: searchParams.get("models")?.split(",").filter(Boolean) ?? [],
    sizes:
      searchParams
        .get("sizes")
        ?.split(",")
        .map((size) => parseFloat(size))
        .filter((n) => Number.isFinite(n)) ?? [],
    minPrice: searchParams.get("minPrice"),
    maxPrice: searchParams.get("maxPrice"),
    ProductName: searchParams.get("ProductName") ?? "",
  });
  const [sort, setSort] = useState<SortOption>(
    (searchParams.get("sort") as SortOption) || "nouveautes",
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

  const productsWithSearch = useMemo(
    () =>
      initialProducts.map((p) => ({
        ...p,
        lowerModelColor: `${p.modelName} ${p.color}`.toLowerCase(),
        sizesNum: p.sizes.map((s) => ({ ...s, sizeNum: Number(s.size) })),
      })),
    [initialProducts],
  );

  const filtered = useMemo(() => {
    return productsWithSearch.filter((p) => {
      if (filterParams.models.length > 0 && !filterParams.models.includes(p.modelName)) {
        return false;
      }

      if (
        filterParams.ProductName &&
        !p.lowerModelColor.includes(filterParams.ProductName.toLowerCase())
      ) {
        return false;
      }

      if (
        filterParams.sizes.length > 0 &&
        !p.sizesNum.some((s) => filterParams.sizes.includes(s.sizeNum) && s.quantity > 0)
      ) {
        return false;
      }

      if (filterParams.minPrice || filterParams.maxPrice) {
        const min = filterParams.minPrice ? Number(filterParams.minPrice) : 0;
        const max = filterParams.maxPrice ? Number(filterParams.maxPrice) : Infinity;
        const effectivePrice = getEffectiveProductPrice(p, filterParams.sizes);
        if (!(effectivePrice >= min && effectivePrice <= max)) return false;
      }

      return true;
    });
  }, [productsWithSearch, filterParams]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    if (sort === "prix-asc") {
      copy.sort(
        (a, b) =>
          getEffectiveProductPrice(a, filterParams.sizes) -
          getEffectiveProductPrice(b, filterParams.sizes),
      );
    } else if (sort === "prix-desc") {
      copy.sort(
        (a, b) =>
          getEffectiveProductPrice(b, filterParams.sizes) -
          getEffectiveProductPrice(a, filterParams.sizes),
      );
    }
    // "nouveautes": keep the server order (already newestAt DESC).
    return copy;
  }, [filtered, sort, filterParams.sizes]);

  const updateSearch = (value: string) => {
    setFilterParams((prev) => ({ ...prev, ProductName: value }));
    const params = new URLSearchParams(window.location.search);
    if (value) params.set("ProductName", value);
    else params.delete("ProductName");
    window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
  };

  const updateSort = (value: SortOption) => {
    setSort(value);
    const params = new URLSearchParams(window.location.search);
    if (value !== "nouveautes") params.set("sort", value);
    else params.delete("sort");
    window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
  };

  // Each model and each size counts once; the price range counts as one
  // filter however many of its two bounds are set.
  // FilterTool is shared with /admin, so it takes its copy as props rather
  // than reaching into a storefront catalog.
  const filterLabels = {
    filters: t("filters.title"),
    model: t("filters.model"),
    size: t("filters.size"),
    bounds: t("filters.bounds"),
    minPlaceholder: t("filters.minPlaceholder"),
    maxPlaceholder: t("filters.maxPlaceholder"),
    remove: (label: string) => t("filters.remove", { label }),
    empty: t("filters.noModel"),
  };

  const activeFilterCount =
    filterParams.models.length +
    filterParams.sizes.length +
    (filterParams.minPrice || filterParams.maxPrice ? 1 : 0);
  const hasActiveFilters = activeFilterCount > 0;

  return (
    <div className="w-full">
      <div className="relative py-4 max-w-md">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-(--sf-muted)"
          strokeWidth={1.5}
        />
        <Input
          defaultValue={filterParams.ProductName ?? ""}
          placeholder={t("search.placeholder")}
          aria-label={t("search.label")}
          className="h-12 w-full ps-9"
          onChange={(e) => updateSearch(e.target.value)}
        />
      </div>

      <div className="lg:grid lg:grid-cols-[240px_1fr] lg:gap-14">
        <div className="hidden lg:sticky lg:block lg:self-start" style={{ top: "calc(var(--sf-nav-offset) + 0.5rem)" }}>
          <FilterTool
            models={models}
            sizes={sizes}
            filterTool={filterParams}
            setfilterTool={setFilterParams}
            boundsMode="price"
            labels={filterLabels}
            accentClassName="text-(--sf-accent)"
            accentHex="var(--sf-accent)"
            mutedHex="var(--sf-muted)"
            variant="storefront"
            className=""
          />
        </div>

        <div className="min-w-0">
          {/* Sticky sub-header, sitting directly under the fixed nav — on every
              breakpoint, so the Filtres trigger stays reachable while the grid
              scrolls. `--sf-nav-offset` drops to 0 while the nav is retracted,
              so this rides up with it instead of leaving a gap. The hairline
              is mobile-only: on desktop the filter rail already separates the
              grid from the page chrome. */}
          <div
            className="sticky z-50 flex w-full items-center justify-between gap-3 border-b border-(--sf-line) bg-(--sf-bg) pb-2 pt-2 lg:border-b-0 lg:pb-4"
            style={{ top: "var(--sf-nav-offset)" }}
          >
            <h2 className="sf-heading text-start text-xl font-medium text-(--sf-text)">
              {t("count", { count: sorted.length })}
            </h2>

            <div className="flex items-center gap-1">
              <div className="hidden items-center gap-1 lg:flex">
                <Select value={sort} onValueChange={(v) => updateSort(v as SortOption)}>
                  <SelectTrigger
                    className="h-9 w-max border-none shadow-none"
                    aria-label={t("sort.label")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="sf-portal">
                    <SelectItem value="nouveautes">{t("sort.newest")}</SelectItem>
                    <SelectItem value="prix-asc">{t("sort.priceAsc")}</SelectItem>
                    <SelectItem value="prix-desc">
                      {t("sort.priceDesc")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <ArrowDownUp className="size-4 text-(--sf-muted)" strokeWidth={1.5} />
              </div>

              <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
                <DrawerTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "flex items-center gap-2 border border-(--sf-line) px-4 py-2 text-sm transition-colors hover:bg-(--sf-hover) lg:hidden",
                      hasActiveFilters && "font-medium text-(--sf-accent)",
                    )}
                    style={{ borderRadius: "var(--sf-radius)" }}
                  >
                    <SlidersHorizontal className="size-4" strokeWidth={1.5} />
                    {t("filters.title")}
                    {hasActiveFilters && (
                      <span
                        className="flex h-5 min-w-5 items-center justify-center bg-(--sf-accent) px-1 text-[11px] font-medium text-(--sf-accent-fg)"
                        style={{ borderRadius: "var(--sf-radius-sm)" }}
                      >
                        {activeFilterCount}
                      </span>
                    )}
                  </button>
                </DrawerTrigger>
                <DrawerContent className="sf-portal flex max-h-[88vh] flex-col">
                  <DrawerHeader className="shrink-0 border-b border-(--sf-line) px-4 pb-3">
                    <DrawerTitle className="sf-heading text-start text-lg font-medium">
                      {t("filters.title")}
                    </DrawerTitle>
                  </DrawerHeader>
                  {/* min-h-0 so this pane — not the drawer — owns the scroll,
                      keeping the "Voir les N résultats" button pinned. */}
                  <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                    <FilterTool
                      models={models}
                      sizes={sizes}
                      filterTool={filterParams}
                      setfilterTool={setFilterParams}
                      boundsMode="price"
                      labels={filterLabels}
                      accentClassName="text-(--sf-accent)"
                      accentHex="var(--sf-accent)"
                      mutedHex="var(--sf-muted)"
                      variant="storefront"
                      className="px-2"
                    />
                  </div>
                  <div className="shrink-0 border-t border-(--sf-line) p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                    <button
                      type="button"
                      onClick={() => setDrawerOpen(false)}
                      className="w-full bg-(--sf-ink) py-4 text-sm font-medium text-(--sf-ink-fg) transition-opacity hover:opacity-90"
                      style={{ borderRadius: "var(--sf-radius)" }}
                    >
                      {t("filters.apply", { count: sorted.length })}
                    </button>
                  </div>
                </DrawerContent>
              </Drawer>
            </div>
          </div>

          {sorted.length === 0 ? (
            <p className="sf-body py-16 text-center text-sm text-(--sf-muted)">
              {t("empty")}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 pb-10 pt-2 md:grid-cols-3 md:gap-4">
              {sorted.map((product, i) => (
                <ProductCard
                  key={product.shoeId}
                  product={product}
                  selectedSizes={filterParams.sizes}
                  priority={i < 6}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
