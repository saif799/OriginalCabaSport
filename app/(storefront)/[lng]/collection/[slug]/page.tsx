import Link from "next/link";
import { notFound } from "next/navigation";
import ProductCard from "@/components/storefront/ProductCard";
import JsonLd from "@/components/storefront/JsonLd";
import Ltr from "@/components/storefront/Ltr";
import { getCollectionBySlug } from "@/lib/storefront/collections";
import {
  BRAND,
  breadcrumbJsonLd,
  itemListJsonLd,
  localeAlternates,
  socialMeta,
} from "@/lib/storefront/seo";
import { getT } from "@/app/i18n/server";
import { isLocale, localePath } from "@/i18n.config";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ lng: string; slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { lng, slug } = await params;
  if (!isLocale(lng)) return {};

  const collection = await getCollectionBySlug(slug);
  if (!collection) return {};

  const { t } = await getT(lng, "catalog");
  const path = `/collection/${encodeURIComponent(collection.slug)}`;
  const description =
    collection.subtitle ??
    t("collection.metaDescription", { title: collection.title, brand: BRAND.name });

  return {
    title: collection.title,
    description,
    alternates: localeAlternates(lng, path),
    // No `images` argument, so this gets the brand card rather than
    // `collection.imageUrl`: ADR-0006 pins the Collection image to exactly one
    // consumer, the homepage card, so that changing that card's shape is the
    // only thing that can change what the image has to be. A 1:1 tile is the
    // wrong crop for a 1.91:1 share preview anyway.
    ...socialMeta({ lng, title: collection.title, description, path }),
  };
}

/**
 * A Collection's own page: a plain product grid and nothing else. No banner
 * image (the card on the homepage is the image's one home — ADR-0006), no
 * filter rail, no sort. There is no /collections index either, so the
 * breadcrumb is two levels deep and nothing links upward past the homepage.
 */
export default async function CollectionPage({ params }: Props) {
  const { lng, slug } = await params;
  if (!isLocale(lng)) notFound();

  const collection = await getCollectionBySlug(slug);
  // Unknown or Hidden. An *Empty* Collection is not a 404 — it renders below
  // with an empty state, because a link shared to a story outlives the stock.
  if (!collection) notFound();

  const { t } = await getT(lng, ["catalog", "common"]);
  const path = `/collection/${encodeURIComponent(collection.slug)}`;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 md:py-8 lg:px-8">
      <JsonLd
        data={breadcrumbJsonLd(lng, [
          { name: t("common:nav.home"), path: "/" },
          { name: collection.title, path },
        ])}
      />
      <JsonLd
        data={itemListJsonLd(
          lng,
          collection.products.slice(0, 100).map((product) => ({
            name: `${product.modelName} — ${product.color}`,
            path: `/product/${encodeURIComponent(product.shoeId)}`,
            image: product.primaryImageUrl,
          })),
        )}
      />

      {/* Breadcrumb — muted, plain, per §9.6. The separator is a neutral "/"
          rather than ">" so it needs no mirroring in RTL. */}
      <nav
        aria-label={t("common:nav.breadcrumbLabel")}
        className="sf-body mb-4 text-sm font-normal text-(--sf-muted)"
      >
        <Link href={localePath(lng, "/")} className="hover:text-(--sf-text)">
          {t("common:nav.home")}
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        {/* Catalog Data: printed verbatim, in an LTR isolate. */}
        <Ltr className="text-(--sf-text)">{collection.title}</Ltr>
      </nav>

      <h1 className="sf-heading text-xl font-medium text-(--sf-text) md:text-3xl">
        <Ltr>{collection.title}</Ltr>
      </h1>
      {collection.subtitle && (
        <p className="sf-body mt-2 max-w-2xl text-sm font-normal text-(--sf-muted)">
          <Ltr>{collection.subtitle}</Ltr>
        </p>
      )}

      {collection.products.length === 0 ? (
        <div className="py-16 text-center">
          <p className="sf-body text-sm font-normal text-(--sf-muted)">
            {t("catalog:collection.empty")}
          </p>
          <Link
            href={localePath(lng, "/products")}
            className="sf-body mt-4 inline-block text-xs font-medium uppercase tracking-[0.12em] text-(--sf-accent) transition-opacity hover:opacity-75"
          >
            {t("catalog:collection.browseAll")}
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3 pb-10 md:grid-cols-3 md:gap-4">
          {collection.products.map((product, i) => (
            <ProductCard key={product.shoeId} product={product} priority={i < 4} />
          ))}
        </div>
      )}
    </div>
  );
}
