import type { Metadata } from "next";
import { DM_Mono, Cairo, Anton } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { dir } from "i18next";
// @ts-ignore - Next.js global stylesheet side-effect import is resolved at build time
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { BRAND, SEO_KEYWORDS, SITE_URL } from "@/lib/storefront/seo";
import { LOCALE_TAGS } from "@/i18n.config";
import { getRequestLocale, isStorefrontRequest } from "@/app/i18n/server";

// The one typeface for both apps, per the storefront design system —
// monospace everywhere. /admin used to fall through to the `--font-sans`
// token (Geist, which was never actually loaded); globals.css now points that
// token at this variable too, so the dashboard matches the store.
// Weights 400/500 only: 300 was dropped when the body floor moved up to 400
// (see --sf-weight-body in globals.css), so shipping it would be dead payload.
const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dm-mono",
});

// DM Mono has no Arabic glyphs, so the Arabic storefront needs its own face.
// It is declared as a CSS variable on <html> — not as an inline style on a
// wrapper — because Radix portals, sonner toasts and Select content all mount
// on <body>, outside any storefront subtree. Anything scoped lower would leave
// them rendering Arabic text in a font that cannot draw it. globals.css maps
// the --sf-font tokens onto it under html[lang="ar"].
//
// That reasoning is about CSS *scoping*, and it never required shipping the
// files to Latin visitors: `preload: false` (issue #20) keeps the @font-face
// declaration everywhere but drops the unconditional <link rel="preload">, so
// a locale that never resolves a --sf-font token onto Cairo fetches none of
// its glyph files. /ar still fetches them, on use. Do not restore the preload
// as an obvious omission, and do not narrow the subsets instead — if a /fr
// page fetches a Cairo file, the cause is a CSS rule resolving --sf-font onto
// Cairo outside html[lang|="ar"]; fix the rule.
const cairo = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["400", "500"],
  variable: "--font-cairo",
  preload: false,
});

// The one exception to "one typeface": the hero headline. DM Mono cannot carry
// a poster-scale line — a monospace has no condensed cut, so at 100px+ it eats
// the whole viewport and still reads thin. Anton is the display face and is
// used in exactly one place (components/storefront/Hero.tsx); it ships a single
// weight (400, already ultra-bold) and Latin only, which is why the headline it
// draws is a fixed English wordmark rather than translated copy.
const anton = Anton({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-anton",
  display: "swap",
});

// Storefront-wide defaults. Every storefront page overrides `title` through
// the template below; /admin overrides `robots` in its own layout so the
// dashboard never gets indexed.
//
// The copy here is French because this file sits above the [lng] segment and
// also covers /admin, so it has no locale to read. It is a fallback that no
// storefront page actually renders: every one of them overrides `title`,
// `description` and `openGraph` in its own locale-aware generateMetadata.
// Per-page canonicals and hreflang are emitted there too; there is deliberately
// no `alternates` default here, since a root-level canonical would point every
// localised page at "/".
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${BRAND.name} — ${BRAND.tagline}`,
    template: `%s | ${BRAND.name}`,
  },
  description: BRAND.descriptionFr,
  keywords: SEO_KEYWORDS,
  applicationName: BRAND.name,
  authors: [{ name: BRAND.name }],
  creator: BRAND.name,
  publisher: BRAND.name,
  category: "shopping",
  openGraph: {
    type: "website",
    siteName: BRAND.name,
    locale: BRAND.locale,
    url: SITE_URL,
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: BRAND.descriptionFr,
  },
  twitter: {
    card: "summary_large_image",
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: BRAND.descriptionFr,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  formatDetection: { telephone: true, address: false, email: false },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // proxy.ts tags every storefront request with its locale; /admin is untagged
  // and stays English and LTR.
  const isStorefront = await isStorefrontRequest();
  const locale = await getRequestLocale();

  // fr-DZ / ar-DZ, not bare fr/ar: the region subtag is a ranking signal for
  // an Algerian storefront and costs nothing.
  const lang = isStorefront ? LOCALE_TAGS[locale] : "en";

  return (
    <html
      lang={lang}
      dir={isStorefront ? dir(locale) : "ltr"}
      // Which of the two apps is rendering. globals.css hangs the /admin-only
      // type rules off this; the storefront keeps using [data-storefront],
      // which its own subtree already sets.
      data-app={isStorefront ? "storefront" : "admin"}
      // Unconditional: /admin resolves --font-sans through --font-dm-mono, so
      // the variables have to exist on <html> for untagged requests too.
      className={`${dmMono.variable} ${cairo.variable} ${anton.variable}`}
    >
      <body className={`font-sans antialiased`}>
        {children}
        <Analytics />
        <Toaster />
      </body>
    </html>
  );
}
