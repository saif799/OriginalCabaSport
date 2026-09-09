/**
 * Cuts the static brand imagery that metadata points at: the share cards
 * (`public/og/og-{fr,ar}.jpg`) and the site icons (`app/icon.png`,
 * `app/apple-icon.png`).
 *
 *   npx tsx lib/scripts/generateBrandImages.ts
 *
 * Run it by hand and commit the output. This is deliberately *not* a
 * `opengraph-image.tsx` route: a share card is fetched by scrapers that give up
 * on a slow response (WhatsApp in particular, which is how most of this
 * catalog gets shared in Algeria), and rendering one per request buys nothing —
 * the card is the same for every page in a locale. Static files are also the
 * only form WhatsApp reliably re-crawls.
 *
 * JPEG, not webp: WhatsApp, Facebook and several Android link previewers still
 * do not decode a webp og:image, and a share card that renders nowhere is
 * worse than one that costs 40 KB more.
 *
 * The type is drawn by librsvg through sharp, so the faces below have to be
 * ones that resolve on the machine running this — they are baked into the
 * output and never shipped as fonts. Impact stands in for Anton (the site's
 * display face, see components/storefront/Hero.tsx): the same condensed
 * ultra-bold silhouette, and unlike Anton it is present by default on Windows
 * and macOS. Arabic is shaped by harfbuzz through Segoe UI / Tahoma; do not
 * add `direction="rtl"` to the <text> elements, librsvg mis-lays it out — the
 * bidi algorithm already orders the runs correctly from the text alone.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

// Run from the repo root, like every other script under lib/scripts. tsx
// compiles this to CJS, so `import.meta.dirname` is not available here.
const ROOT = process.cwd();

/** Kept in step with the tokens in app/globals.css by hand. */
const INK = "#0a110e";
const VOLT = "#a9fb64";
const PAPER = "#fbfefc";
const MUTED = "#d3dbd6";

const DISPLAY = "Impact, 'Arial Black', 'Haettenschweiler', sans-serif";
const LATIN = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const ARABIC = "'Segoe UI', 'Tahoma', 'Arial', sans-serif";

/** The Open Graph frame every platform crops from: 1.91:1. */
const OG_W = 1200;
const OG_H = 630;

/**
 * A share card is read at thumbnail size, so it carries three lines and no
 * more: who, what, and the two facts that close a sale here (the delivery
 * window and cash on delivery).
 *
 * The wordmark stays Latin in both locales — it is the brand's name, not copy,
 * and the Arabic store's own header renders it Latin too.
 */
type Card = {
  /** Volt eyebrow, uppercased Latin or plain Arabic. */
  eyebrow: string;
  /** Supporting line under the wordmark. */
  sub: string;
  /** Arabic sets from the right edge. */
  align: "start" | "end";
  font: string;
  /**
   * Tracking on the eyebrow. Zero for Arabic: the letters of a word are
   * joined, and prising them apart is the Arabic equivalent of setting a Latin
   * word in disconnected capitals.
   */
  tracking: number;
  /** Alt text carried in the metadata alongside the file. */
  alt: string;
};

const CARDS: Record<"fr" | "ar", Card> = {
  fr: {
    eyebrow: "100% AUTHENTIQUE · LIVRAISON 24–48H",
    sub: "Chaussures de basketball originales · 58 wilayas · Paiement à la livraison",
    align: "start",
    font: LATIN,
    tracking: 2.4,
    alt: "Original Caba Sport — chaussures de basketball 100% authentiques en Algérie, livraison 24-48h",
  },
  ar: {
    eyebrow: "أصلية 100٪ · توصيل خلال 24–48 ساعة",
    sub: "أحذية باسكيت أصلية · 58 ولاية · الدفع عند الاستلام",
    align: "end",
    font: ARABIC,
    tracking: 0,
    alt: "Original Caba Sport — أحذية باسكيت أصلية 100% في الجزائر، توصيل خلال 24-48 ساعة",
  },
};

/** XML-escape: the copy above contains no markup, but the alt/sub strings are prose. */
function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&apos;",
  );
}

function cardOverlay(card: Card): Buffer {
  const x = card.align === "start" ? 64 : OG_W - 64;
  const anchor = card.align === "start" ? "start" : "end";

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.30" stop-color="${INK}" stop-opacity="0"/>
      <stop offset="0.62" stop-color="${INK}" stop-opacity="0.72"/>
      <stop offset="1" stop-color="${INK}" stop-opacity="0.96"/>
    </linearGradient>
  </defs>
  <rect width="${OG_W}" height="${OG_H}" fill="url(#scrim)"/>
  <text x="${x}" y="430" text-anchor="${anchor}" font-family="${card.font}" font-size="21"
        font-weight="600" letter-spacing="${card.tracking}" fill="${VOLT}">${esc(card.eyebrow)}</text>
  <text x="${x}" y="522" text-anchor="${anchor}" font-family="${DISPLAY}" font-size="84"
        letter-spacing="1.5" fill="${PAPER}">ORIGINAL CABA SPORT</text>
  <text x="${x}" y="570" text-anchor="${anchor}" font-family="${card.font}" font-size="24"
        fill="${MUTED}">${esc(card.sub)}</text>
</svg>`);
}

async function writeCard(locale: "fr" | "ar") {
  const card = CARDS[locale];
  // `position: top` rather than the default centre crop: the source is 1.47:1
  // against a 1.91:1 frame, and everything worth keeping (the rim, the dunk)
  // sits in the top two thirds — a centred crop takes the ball out of frame.
  const photo = await sharp(path.join(ROOT, "assets/hero/hero_desktop.jpg"))
    .resize(OG_W, OG_H, { fit: "cover", position: "top" })
    .modulate({ brightness: 0.92 })
    .toBuffer();

  const out = path.join(ROOT, "public/og", `og-${locale}.jpg`);
  await sharp(photo)
    .composite([{ input: cardOverlay(card), top: 0, left: 0 }])
    .jpeg({ quality: 82, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .toFile(out);
  return out;
}

/**
 * The tab icon. "OCS" is the short wordmark the store header uses, set on the
 * ink ground with the one Volt rule under it. Three letters is the most that
 * survives a 16px favicon, which is why the full name is not here.
 */
function iconSvg(size: number): Buffer {
  const s = (n: number) => Math.round((n / 512) * size);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" fill="${INK}"/>
  <text x="${size / 2}" y="${s(318)}" text-anchor="middle" font-family="${DISPLAY}"
        font-size="${s(220)}" letter-spacing="${s(4)}" fill="${PAPER}">OCS</text>
  <rect x="${s(118)}" y="${s(358)}" width="${s(276)}" height="${s(30)}" fill="${VOLT}"/>
</svg>`);
}

async function writeIcon(size: number, file: string) {
  const out = path.join(ROOT, file);
  await sharp(iconSvg(size)).png({ compressionLevel: 9 }).toFile(out);
  return out;
}

async function main() {
  await mkdir(path.join(ROOT, "public/og"), { recursive: true });
  const written = [
    await writeCard("fr"),
    await writeCard("ar"),
    await writeIcon(512, "app/icon.png"),
    await writeIcon(180, "app/apple-icon.png"),
  ];
  for (const file of written) console.log("wrote", path.relative(ROOT, file));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
