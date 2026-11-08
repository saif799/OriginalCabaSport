import { notFound } from "next/navigation";
import { I18nProvider } from "next-i18next/client";
import StoreHeader from "@/components/storefront/StoreHeader";
import StoreFooter from "@/components/storefront/StoreFooter";
import JsonLd from "@/components/storefront/JsonLd";
import MetaPixel from "@/components/storefront/MetaPixel";
import GoogleAnalytics from "@/components/storefront/GoogleAnalytics";
import { BRAND, organizationJsonLd, websiteJsonLd } from "@/lib/storefront/seo";
import { getResources, getT } from "@/app/i18n/server";
import { NAMESPACES, isLocale } from "@/i18n.config";
import { serverI18nConfig } from "@/app/i18n/serverConfig";

/**
 * The --font-dm-mono / --font-cairo variables and `lang`/`dir` are set on
 * <html> by the root layout (only for storefront requests) so Radix portals
 * can resolve them too. This layout just switches the theme on:
 * [data-storefront] applies the font, ink colour and white ground defined in
 * globals.css.
 */
export default async function StorefrontLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lng: string }>;
}) {
  const { lng } = await params;
  // A bad locale segment would otherwise render the whole storefront with
  // fallback copy under a nonsense URL — 404 instead.
  if (!isLocale(lng)) notFound();

  // Deliberately read here and not in the root layout: the root layout is
  // shared with /admin, and this route group is exactly the storefront
  // boundary. Unset (dev, previews) renders nothing at all.
  const pixelId = process.env.FB_PIXEL_ID;
  const gaId = process.env.GA_MEASUREMENT_ID;

  const { i18n } = await getT(lng);
  // The store-level JSON-LD carries prose, so it is translated like any other
  // copy — a French description on /ar contradicts the page describing it.
  const { t } = await getT(lng, ["common", "home", "catalog"]);
  // Scoped on purpose. getResources() defaults to serialising *every*
  // preloaded language into the HTML; naming the languages keeps the payload
  // to what this page can actually render. The fallback has to be included or
  // client-side fallback silently resolves to nothing.
  const resources = getResources(i18n, [...NAMESPACES], [
    lng,
    serverI18nConfig.fallbackLng as string,
  ]);

  return (
    <I18nProvider
      language={lng}
      resources={resources}
      supportedLngs={serverI18nConfig.supportedLngs}
      defaultNS={serverI18nConfig.defaultNS}
      fallbackLng={serverI18nConfig.fallbackLng}
    >
      <div data-storefront="" className="sf-body flex min-h-screen flex-col">
        {/* Identity + searchability, on every storefront page so a crawler that
            lands deep in the catalog still learns who the seller is. */}
        <JsonLd
          data={organizationJsonLd({
            lng,
            slogan: t("common:brand.slogan"),
            description: t("home:metaDescription", { brand: BRAND.name }),
            catalogName: t("catalog:heading"),
          })}
        />
        <JsonLd
          data={websiteJsonLd(lng, t("home:metaDescription", { brand: BRAND.name }))}
        />
        {pixelId && <MetaPixel pixelId={pixelId} />}
        {gaId && <GoogleAnalytics gaId={gaId} />}
        <StoreHeader />
        {/* Offsets the fixed 64px nav. */}
        <main className="flex-1 pt-(--sf-nav-h)">{children}</main>
        <StoreFooter lng={lng} />
      </div>
    </I18nProvider>
  );
}
