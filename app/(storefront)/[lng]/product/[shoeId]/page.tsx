import { notFound } from "next/navigation";
import Link from "next/link";
import ImageCarousel from "@/components/storefront/ImageCarousel";
import ProductOrderPanel from "@/components/storefront/ProductOrderPanel";
import ViewContentTracker from "@/components/storefront/ViewContentTracker";
import TrustBand from "@/components/storefront/TrustBand";
import ProductFaq from "@/components/storefront/ProductFaq";
import ProductPrice from "@/components/storefront/ProductPrice";
import Ltr from "@/components/storefront/Ltr";
import { formatDZD } from "@/lib/format";
import { getStorefrontProductDetail } from "@/lib/storefront/products";
import JsonLd from "@/components/storefront/JsonLd";
import { getStorefrontFaqs } from "@/lib/storefront/faq";
import {
  BRAND,
  breadcrumbJsonLd,
  faqJsonLd,
  localeAlternates,
  productJsonLd,
  socialMeta,
} from "@/lib/storefront/seo";
import { getT } from "@/app/i18n/server";
import { isLocale, localePath, type Locale } from "@/i18n.config";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ lng: string; shoeId: string }> };

export async function generateMetadata({ params }: Props) {
  const { lng, shoeId } = await params;
  if (!isLocale(lng)) return {};
  const { t } = await getT(lng, "product");

  const product = await getStorefrontProductDetail(shoeId);
  if (!product) {
    return {
      title: t("notFound"),
      robots: { index: false, follow: true },
    };
  }

  const name = `${product.modelName} — ${product.color}`;
  const path = `/product/${encodeURIComponent(shoeId)}`;
  const description = t("metaDescription", {
    name,
    price: formatDZD(product.price),
    brand: BRAND.name,
  });

  return {
    title: t("metaTitle", { name }),
    description,
    alternates: localeAlternates(lng, path),
    // The shoe's own photographs, first. socialMeta appends the brand card
    // behind them, so a shared product link is never a bare grey rectangle —
    // whether the variant has no gallery row at all (rare but reachable:
    // nothing requires an image before a product goes live) or the scraper
    // cannot decode the webp.
    ...socialMeta({
      lng,
      title: `${name} | ${BRAND.name}`,
      description,
      path,
      images: product.images.slice(0, 4).map((image) => ({
        url: image.url,
        alt: image.altText ?? name,
      })),
    }),
  };
}

/** The system's one Volt highlight — see Hero.tsx — reused for the eyebrow. */
function AuthenticBadge({ label }: { label: string }) {
  return (
    <span
      className="sf-body text-[11px] font-medium uppercase tracking-[0.08em] text-(--sf-highlight-fg)"
      style={{
        borderRadius: "var(--sf-radius-sm)",
        backgroundColor: "var(--sf-highlight)",
        padding: "4px 6px",
      }}
    >
      {label}
    </span>
  );
}

export default async function ProductPage({ params }: Props) {
  const { lng, shoeId } = await params;
  if (!isLocale(lng)) notFound();
  const locale: Locale = lng;

  const { t } = await getT(locale, ["product", "common"]);
  const product = await getStorefrontProductDetail(shoeId);
  if (!product) notFound();

  const productName = `${product.modelName} — ${product.color}`;
  const inStock = product.sizes.some((size) => size.quantity > 0);
  const faqs = await getStorefrontFaqs(locale);

  // One string, rendered as the visible paragraph below and handed to the
  // Product JSON-LD above — Google wants those to be the same text.
  const prose = t("product:prose", { name: productName, brand: BRAND.name });

  return (
    <main className="mx-auto max-w-6xl px-4 pt-8 pb-24 md:px-8 lg:px-16 lg:pb-8">
      {/* Offer + shipping details: the machine-readable half of the 24-48h
          promise the TrustBand states in prose just below. */}
      <JsonLd
        data={productJsonLd({
          lng: locale,
          shoeId: product.shoeId,
          modelName: product.modelName,
          color: product.color,
          description: prose,
          price: product.price,
          compareAtPrice: product.compareAtPrice,
          images: product.images.map((image) => image.url),
          inStock,
          sizes: product.sizes.filter((s) => s.quantity > 0).map((s) => s.size),
        })}
      />
      <JsonLd
        data={breadcrumbJsonLd(locale, [
          { name: t("common:nav.home"), path: "/" },
          { name: t("common:nav.products"), path: "/products" },
          {
            name: productName,
            path: `/product/${encodeURIComponent(product.shoeId)}`,
          },
        ])}
      />
      <JsonLd data={faqJsonLd(locale, faqs)} />
      {/* Breadcrumb — muted, plain, per §9.6. The separator is a neutral "/"
          rather than ">" so it needs no mirroring in RTL. */}
      <nav
        aria-label={t("common:nav.breadcrumbLabel")}
        className="sf-body mb-4 text-sm font-normal text-(--sf-muted)"
      >
        <Link href={localePath(locale, "/")} className="hover:text-(--sf-text)">
          {t("common:nav.home")}
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <Link
          href={localePath(locale, "/products")}
          className="hover:text-(--sf-text)"
        >
          {t("common:nav.products")}
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        {/* Catalog Data: printed verbatim in an LTR isolate. */}
        <Ltr className="text-(--sf-text)">{productName}</Ltr>
      </nav>

      {/* Title + price above the gallery on mobile, beside it on desktop. */}
      <div className="mb-4 lg:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <AuthenticBadge label={t("product:authenticBadge")} />
          <Ltr className="sf-body text-xs font-normal uppercase tracking-[0.12em] text-(--sf-muted)">
            {product.modelName.toUpperCase()}
          </Ltr>
        </div>
        <h1 className="sf-heading mt-2 text-lg font-medium text-(--sf-text)">
          <Ltr>{productName}</Ltr>
        </h1>
        <ProductPrice
          price={product.price}
          compareAtPrice={product.compareAtPrice}
          size="md"
          className="mt-2"
        />
      </div>

      {/* No-ops unless the pixel actually loaded, so no env check needed here. */}
      <ViewContentTracker
        shoeId={product.shoeId}
        contentName={productName}
        value={product.price}
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[60%_1fr] lg:gap-12">
        <ImageCarousel images={product.images} productName={productName} />

        <div className="flex flex-col gap-5">
          <div className="hidden lg:block">
            <div className="flex flex-wrap items-center gap-3">
              <AuthenticBadge label={t("product:authenticBadge")} />
              <Ltr className="sf-body text-sm text-(--sf-muted)">
                {product.modelName.toUpperCase()}
              </Ltr>
            </div>
            <h1 className="sf-heading mt-2 text-2xl font-medium text-(--sf-text)">
              <Ltr>{productName}</Ltr>
            </h1>
            <ProductPrice
              price={product.price}
              compareAtPrice={product.compareAtPrice}
              size="lg"
              className="mt-3"
            />
          </div>

          <ProductOrderPanel
            shoeId={product.shoeId}
            modelName={product.modelName}
            color={product.color}
            sizes={product.sizes}
            price={product.price}
            compareAtPrice={product.compareAtPrice}
          />
          {/* The only prose on the page that describes the product itself.
              Without it a crawler sees a name, a price and a size picker —
              nothing that matches an "authentic <model> in Algeria" query. */}
          <p className="sf-body text-sm font-normal text-(--sf-muted)">
            {prose}
          </p>
          <TrustBand lng={locale} />
          <ProductFaq lng={locale} />
        </div>
      </div>
    </main>
  );
}
