/**
 * The brand identity and the schema.org JSON-LD builders.
 *
 * The *prose* an assistant reads — the delivery promise, the descriptions, the
 * slogan — used to live here too, as French constants (`DELIVERY.sentenceFr`
 * and friends). It was moved into app/i18n/locales/{ar,fr}/, because a single
 * French constant interpolated into every surface is precisely what rendered
 * French clauses mid-sentence on the Arabic store. Copy is per-locale; this
 * file keeps only what is language-neutral (URLs, identifiers, numbers) and
 * takes the translated strings as arguments.
 *
 * The tradeoff is real and deliberate: "24-48h" and "58 wilayas" are now
 * written out in each catalog rather than derived from one constant, so
 * changing either is a two-file edit. tests/i18n.test.ts holds the catalogs to
 * the same key set, but it cannot check that the two agree on a number.
 */

import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_TAGS,
  localePath,
  type Locale,
} from "@/i18n.config";

export const BRAND = {
  /** Legal / searchable name. The header keeps the short "OCS" wordmark. */
  name: "Original Caba Sport",
  short: "OCS",
  /** How the two are written together wherever both matter (titles, JSON-LD). */
  full: "Original Caba Sport (OCS)",
  tagline: "Chaussures de basketball 100% authentiques en Algérie",
  descriptionFr:
    "Original Caba Sport (OCS) vend des chaussures de basketball 100% authentiques en Algérie. Livraison rapide en 24 à 48h dans les 58 wilayas, paiement à la livraison.",
  descriptionEn:
    "Original Caba Sport (OCS) sells 100% authentic basketball shoes in Algeria, with fast 24-48h delivery to all 58 wilayas and cash on delivery.",
  whatsapp: process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "213559913230",
  country: "DZ",
  locale: "fr_DZ",
  currency: "DZD",
} as const;

/**
 * Absolute origin for canonicals, sitemap entries and JSON-LD @id values.
 * These must be the *public* domain — a localhost canonical tells Google the
 * page is unreachable — so production has to set NEXT_PUBLIC_SITE_URL (or a
 * real NEXT_PUBLIC_BASE_URL).
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.NEXT_PUBLIC_BASE_URL ??
  "http://localhost:3000"
).replace(/\/$/, "");

export function absoluteUrl(path = "/"): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * OpenGraph spells locales with an underscore ("ar_DZ"), unlike hreflang.
 * Without this every page inherited the French default from the root layout,
 * which told a share preview that an Arabic page was French.
 */
export function ogLocale(lng: Locale): string {
  return LOCALE_TAGS[lng].replace("-", "_");
}

/** Absolute URL for a storefront path in a given locale. */
export function localeUrl(lng: Locale, path = "/"): string {
  return absoluteUrl(localePath(lng, path));
}

/**
 * The `alternates` block every storefront page must emit: a self-referential
 * canonical plus the hreflang set.
 *
 * This is plumbing, not translation. /ar/... and /fr/... now serve genuinely
 * different copy, which makes the tags more load-bearing, not less: without
 * them Google picks a winner itself, which can drop one locale from the index
 * or land French visitors on Arabic chrome. next-i18next emits none of this.
 *
 * x-default points at the Arabic URL because Arabic is the routing default —
 * it is where an unmatched visitor is sent by proxy.ts.
 */
export function localeAlternates(lng: Locale, path = "/") {
  return {
    canonical: localePath(lng, path),
    languages: {
      ...Object.fromEntries(
        LOCALES.map((locale) => [LOCALE_TAGS[locale], localePath(locale, path)]),
      ),
      "x-default": localePath(DEFAULT_LOCALE, path),
    },
  };
}

/**
 * The share card. One static file per locale, cut by
 * lib/scripts/generateBrandImages.ts and committed — see the header there for
 * why this is a file on disk and not an `opengraph-image.tsx` route, and why
 * it is a JPEG.
 *
 * Every storefront page that has no photograph of its own points at this, so a
 * link pasted into WhatsApp, Messenger or a Facebook ad always resolves to
 * something. The product page overrides it with the shoe's own images; nothing
 * else does.
 *
 * The alt text is the one piece of copy in this file that is still written per
 * locale here rather than in app/i18n/locales — the image it describes is
 * baked, so the sentence has to match what was drawn into the pixels, not what
 * a catalog says today.
 */
const OG_IMAGE_ALT: Record<Locale, string> = {
  fr: "Original Caba Sport — chaussures de basketball 100% authentiques en Algérie, livraison 24-48h",
  ar: "Original Caba Sport — أحذية باسكيت أصلية 100% في الجزائر، توصيل خلال 24-48 ساعة",
};

/**
 * Relative on purpose: Next resolves it against `metadataBase` (the root
 * layout), which is the one place SITE_URL is applied to metadata. Emitting an
 * absolute URL here would produce a localhost og:image in any preview build
 * whose NEXT_PUBLIC_SITE_URL is unset.
 */
export function ogImages(lng: Locale) {
  return [
    {
      url: `/og/og-${lng}.jpg`,
      width: 1200,
      height: 630,
      type: "image/jpeg",
      alt: OG_IMAGE_ALT[lng],
    },
  ];
}

/**
 * The `openGraph` + `twitter` half of a storefront page's metadata.
 *
 * It exists because Next replaces these blocks wholesale rather than merging
 * them field by field: a page that declares `openGraph.title` drops the root
 * layout's `type` and `siteName` with it, and one that declares no `twitter`
 * block at all inherits the root's — which is French, and was captioning the
 * Arabic store with French copy and the French share card. Both were silent.
 *
 * So every storefront page spreads this instead of hand-rolling the pair. The
 * only page that passes its own `images` is the product page, whose own
 * photographs beat the brand card.
 *
 * The brand card is appended to those photographs rather than replaced by
 * them, and that is the point of the ordering: since ADR-0007 every uploaded
 * image is a webp, and the scrapers that matter most here — WhatsApp above all,
 * which is how a link actually travels in this market — are inconsistent about
 * decoding one. A scraper walks the og:image list and takes the first it can
 * render, so the shoe wins wherever webp works and the JPEG card catches the
 * rest. Without it those clients show no preview at all.
 */
export function socialMeta(input: {
  lng: Locale;
  title: string;
  description: string;
  /** Unlocalised path, e.g. "/products" — the locale prefix is added here. */
  path: string;
  images?: { url: string; alt?: string }[];
}) {
  const images = [...(input.images ?? []), ...ogImages(input.lng)];

  return {
    openGraph: {
      type: "website" as const,
      siteName: BRAND.name,
      locale: ogLocale(input.lng),
      title: input.title,
      description: input.description,
      url: localePath(input.lng, input.path),
      images,
    },
    twitter: {
      card: "summary_large_image" as const,
      title: input.title,
      description: input.description,
      images: images.map((image) => image.url),
    },
  };
}

/** Terms real buyers type in this market — used for the keywords meta and copy. */
export const SEO_KEYWORDS = [
  "Original Caba Sport",
  "OCS",
  "chaussures de basketball Algérie",
  "basket homme Algérie",
  "sneakers authentiques Algérie",
  "chaussures de basket originales",
  "Nike Jordan Algérie",
  "livraison 24h 48h Algérie",
  "paiement à la livraison",
  "basketball shoes Algeria",
];

type JsonLd = Record<string, unknown>;

/**
 * The store itself. `OnlineStore` (a subtype of Organization) is the type
 * assistants map to "a shop you can buy from"; `areaServed` plus the delivery
 * lead time are what let one answer "who ships basketball shoes fast in
 * Algeria?".
 */
export function organizationJsonLd(input: {
  lng: Locale;
  /** `common:brand.slogan`, translated by the caller. */
  slogan: string;
  /** `home:metaDescription`, translated by the caller. */
  description: string;
  /** `catalog:heading`, translated by the caller. */
  catalogName: string;
}): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "OnlineStore",
    "@id": `${SITE_URL}/#store`,
    name: BRAND.name,
    alternateName: [BRAND.short, BRAND.full],
    url: SITE_URL,
    description: input.description,
    slogan: input.slogan,
    knowsLanguage: ["fr", "ar", "en"],
    areaServed: {
      "@type": "Country",
      name: "Algeria",
      alternateName: "Algérie",
      identifier: BRAND.country,
    },
    currenciesAccepted: BRAND.currency,
    paymentAccepted: "Paiement à la livraison, Cash on delivery",
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "customer service",
        telephone: `+${BRAND.whatsapp}`,
        areaServed: BRAND.country,
        availableLanguage: ["fr", "ar"],
      },
    ],
    sameAs: [`https://wa.me/${BRAND.whatsapp}`],
    makesOffer: {
      "@type": "Offer",
      itemOffered: {
        "@type": "Product",
        name: input.catalogName,
        category: "Basketball shoes",
      },
      areaServed: BRAND.country,
      priceCurrency: BRAND.currency,
      // The 24-48h promise as a number. The prose form is per-locale copy in
      // app/i18n/locales; keep this in step with it, and with the transit time
      // in shippingDetailsJsonLd below, by hand.
      deliveryLeadTime: {
        "@type": "QuantitativeValue",
        minValue: 24,
        maxValue: 48,
        unitCode: "HUR",
      },
    },
  };
}

/** Enables the sitelinks search box and tells crawlers the catalog is searchable. */
export function websiteJsonLd(lng: Locale, description: string): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: SITE_URL,
    name: BRAND.full,
    description,
    inLanguage: LOCALE_TAGS[lng],
    publisher: { "@id": `${SITE_URL}/#store` },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${localeUrl(lng, "/products")}?ProductName={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/**
 * The shipping block every product offer carries. This is the single
 * machine-readable statement of the 24-48h promise: same-day handling plus a
 * 1-2 day transit time.
 */
function shippingDetailsJsonLd(): JsonLd {
  return {
    "@type": "OfferShippingDetails",
    shippingDestination: {
      "@type": "DefinedRegion",
      addressCountry: BRAND.country,
    },
    deliveryTime: {
      "@type": "ShippingDeliveryTime",
      handlingTime: {
        "@type": "QuantitativeValue",
        minValue: 0,
        maxValue: 1,
        unitCode: "DAY",
      },
      // schema.org wants whole days for transit time: 24-48h == 1-2 days.
      transitTime: {
        "@type": "QuantitativeValue",
        minValue: 1,
        maxValue: 2,
        unitCode: "DAY",
      },
    },
  };
}

export type ProductJsonLdInput = {
  lng: Locale;
  shoeId: string;
  modelName: string;
  color: string;
  /**
   * The prose an assistant quotes, already translated by the caller from
   * `product:prose`. It is passed in rather than built here because Google
   * requires structured data to match the visible text, and the visible
   * paragraph on the page is the same string — building a second French copy
   * here is what used to put French prose on the Arabic product page.
   */
  description: string;
  price: number;
  compareAtPrice: number | null;
  images: string[];
  inStock: boolean;
  sizes: string[];
};

export function productJsonLd(product: ProductJsonLdInput): JsonLd {
  const url = localeUrl(product.lng, `/product/${encodeURIComponent(product.shoeId)}`);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${url}#product`,
    name: `${product.modelName} — ${product.color}`,
    description: product.description,
    sku: product.shoeId,
    // The shoe id is the printed barcode value, so it doubles as the
    // manufacturer-part identifier a shopping crawler looks for.
    mpn: product.shoeId,
    color: product.color,
    category: "Chaussures de basketball",
    image: product.images,
    url,
    inLanguage: LOCALE_TAGS[product.lng],
    brand: { "@type": "Brand", name: product.modelName },
    ...(product.sizes.length > 0
      ? {
          size: product.sizes,
          additionalProperty: product.sizes.map((size) => ({
            "@type": "PropertyValue",
            name: "Pointure",
            value: size,
          })),
        }
      : {}),
    offers: {
      "@type": "Offer",
      url,
      priceCurrency: BRAND.currency,
      price: product.price,
      ...(product.compareAtPrice && product.compareAtPrice > product.price
        ? {
            priceSpecification: {
              "@type": "UnitPriceSpecification",
              priceType: "https://schema.org/ListPrice",
              price: product.compareAtPrice,
              priceCurrency: BRAND.currency,
            },
          }
        : {}),
      availability: product.inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      areaServed: BRAND.country,
      seller: { "@id": `${SITE_URL}/#store` },
      shippingDetails: shippingDetailsJsonLd(),
    },
  };
}

export function breadcrumbJsonLd(
  lng: Locale,
  trail: { name: string; path: string }[],
): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name,
      item: localeUrl(lng, crumb.path),
    })),
  };
}

/**
 * `inLanguage` is derived here, unlike the other builders which stay pinned to
 * fr-DZ. Google requires FAQ structured data to match the visible text, and the
 * FAQ *is* translated (it is store chrome, not SEO copy) — so on /ar this block
 * carries Arabic questions and must declare Arabic, or it contradicts the page
 * it describes.
 */
export function faqJsonLd(
  lng: Locale,
  faqs: { question: string; answer: string }[],
): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: LOCALE_TAGS[lng],
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };
}

/** A catalog page as an ItemList, so crawlers see the products without JS. */
export function itemListJsonLd(
  lng: Locale,
  items: { name: string; path: string; image?: string | null }[],
): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: localeUrl(lng, item.path),
      name: item.name,
      ...(item.image ? { image: item.image } : {}),
    })),
  };
}
