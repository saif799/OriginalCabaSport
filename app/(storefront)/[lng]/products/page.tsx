import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getStorefrontProducts, getStorefrontModels } from "@/lib/storefront/products";
import ProductsBrowser from "@/components/storefront/ProductsBrowser";
import JsonLd from "@/components/storefront/JsonLd";
import {
  BRAND,
  breadcrumbJsonLd,
  itemListJsonLd,
  localeAlternates,
  socialMeta,
} from "@/lib/storefront/seo";
import { getT } from "@/app/i18n/server";
import { isLocale } from "@/i18n.config";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ lng: string }> };

export async function generateMetadata({ params }: Props) {
  const { lng } = await params;
  if (!isLocale(lng)) return {};
  const { t } = await getT(lng, ["catalog", "home"]);

  return {
    title: t("catalog:metaTitle"),
    description: t("catalog:metaDescription", { brand: BRAND.name }),
    alternates: localeAlternates(lng, "/products"),
    ...socialMeta({
      lng,
      title: t("catalog:ogTitle", { brand: BRAND.name }),
      description: t("home:metaDescription", { brand: BRAND.name }),
      path: "/products",
    }),
  };
}

export default async function ProductsPage({ params }: Props) {
  const { lng } = await params;
  if (!isLocale(lng)) notFound();

  const { t } = await getT(lng, ["catalog", "common"]);
  const [products, models] = await Promise.all([
    getStorefrontProducts(),
    getStorefrontModels(),
  ]);

  // Derived from the actual catalog, not a hardcoded size range — sizes are
  // free-text varchar, so guard against anything non-numeric.
  const sizeSet = new Set<number>();
  for (const product of products) {
    for (const s of product.sizes) {
      const n = Number(s.size);
      if (Number.isFinite(n)) sizeSet.add(n);
    }
  }
  const sizes = [...sizeSet].sort((a, b) => a - b);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 md:py-8 lg:px-8">
      <p className="sf-body text-xs font-medium uppercase tracking-[0.12em] text-(--sf-muted)">
        {t("catalog:eyebrow")}
      </p>
      <h1 className="sf-heading mt-3 text-xl font-medium text-(--sf-text) md:mt-4 md:text-3xl">
        {t("catalog:heading")}
      </h1>
      {/* One sentence of indexable copy under the H1. The listing itself is
          rendered client-side by ProductsBrowser, so without this the page has
          no crawlable text of its own. */}
      <p className="sf-body mt-2 max-w-2xl text-sm font-normal text-(--sf-muted)">
        {t("catalog:lede", { count: products.length, brand: BRAND.name })}
      </p>
      <JsonLd
        data={breadcrumbJsonLd(lng, [
          { name: t("common:nav.home"), path: "/" },
          { name: t("common:nav.products"), path: "/products" },
        ])}
      />
      {/* The product grid is client-rendered; this mirrors it for crawlers. */}
      <JsonLd
        data={itemListJsonLd(
          lng,
          products.slice(0, 100).map((product) => ({
            name: `${product.modelName} — ${product.color}`,
            path: `/product/${encodeURIComponent(product.shoeId)}`,
            image: product.primaryImageUrl,
          })),
        )}
      />
      <Suspense>
        <ProductsBrowser
          initialProducts={products}
          models={models.map((m) => m.modelName)}
          sizes={sizes}
        />
      </Suspense>
    </div>
  );
}
