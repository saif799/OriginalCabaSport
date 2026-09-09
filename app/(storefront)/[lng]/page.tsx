import { notFound } from "next/navigation";
import Hero from "@/components/storefront/Hero";
import AuthenticityBand from "@/components/storefront/AuthenticityBand";
import CollectionCard from "@/components/storefront/CollectionCard";
import FaqSection from "@/components/storefront/FaqSection";
import { getVisibleCollections } from "@/lib/storefront/collections";
import JsonLd from "@/components/storefront/JsonLd";
import { getStorefrontFaqs } from "@/lib/storefront/faq";
import { BRAND, faqJsonLd, localeAlternates, socialMeta } from "@/lib/storefront/seo";
import { getT } from "@/app/i18n/server";
import { isLocale } from "@/i18n.config";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ lng: string }> };

export async function generateMetadata({ params }: Props) {
  const { lng } = await params;
  if (!isLocale(lng)) return {};
  const { t } = await getT(lng, "home");

  return {
    // Absolute: the homepage title should not be suffixed with the brand twice.
    title: { absolute: t("metaTitle", { brand: BRAND.name }) },
    description: t("metaDescription", { brand: BRAND.name }),
    alternates: localeAlternates(lng, "/"),
    ...socialMeta({
      lng,
      title: t("ogTitle", { brand: BRAND.name }),
      description: t("metaDescription", { brand: BRAND.name }),
      path: "/",
    }),
  };
}

/**
 * Hero, then the Collections grid, then the bands. No product rails and no
 * prices — deliberately, and against the recommendation on the table at the
 * time: ADR-0006 records the conversion cost this accepts and names the hybrid
 * (grid plus one auto-generated rail) as the intended fallback if it bites.
 */
export default async function StorefrontPage({ params }: Props) {
  const { lng } = await params;
  if (!isLocale(lng)) notFound();

  const { t } = await getT(lng, "home");
  const collections = await getVisibleCollections();
  const faqs = await getStorefrontFaqs(lng);

  return (
    <>
      <Hero lng={lng} />

      {collections.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 md:py-14 lg:px-8">
          <div className="mb-6 border-b border-(--sf-line) pb-4">
            <h2 className="sf-heading text-xl font-medium text-(--sf-text) md:text-2xl">
              {t("collections.heading")}
            </h2>
          </div>

          {/* Same columns as the product grid — the two surfaces are one system. */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
            {collections.map((collection, i) => (
              <CollectionCard
                key={collection.id}
                collection={collection}
                lng={lng}
                priority={i < 3}
              />
            ))}
          </div>
        </section>
      )}

      <AuthenticityBand lng={lng} />

      <FaqSection lng={lng} />

      {/* The FAQ answers carry the delivery window and the authenticity claim
          in machine-readable form — this is what an assistant quotes. */}
      <JsonLd data={faqJsonLd(lng, faqs)} />
    </>
  );
}
