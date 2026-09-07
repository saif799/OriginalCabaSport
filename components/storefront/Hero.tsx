import Link from "next/link";
import { getT } from "@/app/i18n/server";
import { localePath, type Locale } from "@/i18n.config";

/**
 * A full-bleed photograph and one line of poster type. Nothing else.
 *
 * Static — no DB, no hero table (see ADR-0002, superseding ADR-0001 §1).
 *
 * What was removed, and why it is not coming back piecemeal: the badge, the
 * localised h1, the "vérifiée avant expédition" subtitle, two CTAs and the
 * tagline. The delivery promise in particular is now stated in exactly three
 * places (the authenticity band, the trust band, the FAQ) instead of four, and
 * the hero is the one screen that has to sell the brand rather than explain the
 * logistics. `hero.title` survives in the catalogs because the sr-only line
 * below still uses it — it is the only localised, keyword-bearing sentence on
 * this screen, and dropping it would take the Arabic/French homepage h1 with it.
 *
 * ART DIRECTION — two different photographs, not one image cropped twice: the
 * desktop frame is a wide court shot that has nothing left in a 9:16 crop, the
 * mobile frame is a portrait product shot. That is what <picture> is for, and
 * it is why this is not a next/image: <Image> picks a *width*, never a
 * different photograph, so a next/image hero would have to download both and
 * hide one. <picture> media queries fetch exactly one.
 *
 * This is unrelated to ADR-0007. These are static derivatives in public/, cut
 * by hand at build time; the custom image loader only rewrites the R2 keys of
 * uploaded photographs and never sees them.
 *
 * TWO HEIGHT MODELS, one per frame, because the two photographs want opposite
 * things and an earlier single `h-[100svh]` + object-contain served neither —
 * it letterboxed the phone crop in black bands.
 *
 *   - Phone: the section has no height of its own. The <img> is in normal flow
 *     at `w-full h-auto` and the type is an absolute overlay, so the frame is
 *     the 9:16 photo's own aspect ratio: nothing cropped, nothing padded, and
 *     the hero ends a little above the fold on a tall handset.
 *   - md and up: `h-[100svh]`, the img absolute and `object-cover`. The desktop
 *     frame is 3:2 against a ~16:9 viewport, so covering trims a few percent
 *     off the top and bottom of a shot that has room to lose there — the cost
 *     of a hero that is exactly one screen, which is the point of it.
 *
 * `bg-black` survives only as the ground under a photo that has not decoded.
 *
 * The files under public/hero are derivatives; the originals live in
 * assets/hero/ (outside public/, so 4 MB of source is neither served nor
 * deployed). Regenerate after replacing a source photo:
 *
 *   sharp(src).resize({ width: w }).webp({ quality: 68, effort: 6 })
 *   // desktop w = 1280 / 1920 / 2560, mobile w = 640 / 828 / 1200 at q72,
 *   // plus one .jpg fallback each (desktop 1600, mobile 828) at q76.
 */

/**
 * Fixed English, in both locales, on purpose. It is a wordmark, not copy: the
 * face that draws it (Anton, see .sf-poster) has no Arabic glyphs, so an
 * Arabic translation here would silently fall back to a different font at
 * 100px. The localised sentence lives in the sr-only line instead.
 *
 * Three fragments, not two, because each one takes its own line at every
 * width; splitting "for athletes" is what lets the stack break after "for".
 */
const HEADLINE = ["We sell", "for", "athletes"] as const;

export default async function Hero({ lng }: { lng: Locale }) {
  const { t } = await getT(lng, "home");

  return (
    <section
      // StoreHeader probes for this to know whether the bar is still floating
      // over the photo (and so must stay transparent) or has scrolled onto the
      // white page ground. Renaming it silently turns the bar opaque at the top
      // of the homepage.
      data-sf-hero
      className="relative isolate -mt-(--sf-nav-h) w-full bg-black md:h-[100svh]"
    >
      <picture>
        {/* Order matters: the first matching <source> wins, so the desktop
            pair is listed before the unconditional mobile pair. */}
        <source
          media="(min-width: 768px)"
          type="image/webp"
          sizes="100vw"
          srcSet="/hero/hero-desktop-1280.webp 1280w, /hero/hero-desktop-1920.webp 1920w, /hero/hero-desktop-2560.webp 2560w"
        />
        <source media="(min-width: 768px)" srcSet="/hero/hero-desktop-1600.jpg" />
        <source
          type="image/webp"
          sizes="100vw"
          srcSet="/hero/hero-mobile-640.webp 640w, /hero/hero-mobile-828.webp 828w, /hero/hero-mobile-1200.webp 1200w"
        />
        <img
          src="/hero/hero-mobile-828.jpg"
          alt=""
          // Decorative: the headline and the sr-only line below carry the
          // meaning, so an alt here would only make a screen reader read the
          // same screen twice.
          aria-hidden="true"
          // The LCP element. fetchPriority is what `priority` on next/image
          // resolves to anyway, and it is the part that matters here.
          fetchPriority="high"
          decoding="async"
          // In flow on the phone, where the photo is what gives the section its
          // height; absolute and cover from md up, where the section is a full
          // screen and the photo has to fill it.
          className="block h-auto w-full md:absolute md:inset-0 md:h-full md:object-cover"
        />
      </picture>

      {/* Legibility scrim. Even, not bottom-weighted: the type sits in the
          middle of the frame, so the darkening has to be where the type is. */}
      <div aria-hidden="true" className="absolute inset-0 bg-black/30" />

      <div className="absolute inset-0 flex flex-col items-center justify-center px-5 sm:px-6 lg:px-8">
        {/* dir is pinned: the line is Latin, and on /ar the surrounding RTL
            context would otherwise reorder the spans. */}
        <h1
          dir="ltr"
          // .sf-poster is unlayered CSS, so its line-height: 0.88 outranks any
          // Tailwind leading-* utility — the looser stack has to be set here.
          style={{ lineHeight: 1.14 }}
          className="sf-poster w-full text-center text-[clamp(3.25rem,16vw,5.5rem)] text-white [text-shadow:0_2px_28px_rgba(0,0,0,0.45)] md:text-[clamp(4.5rem,9vw,8rem)]"
        >
          {/* One word per line at every width. Running it back into a single
              desktop line was tried and dropped: the three-line stack is the
              wordmark, and it should not read as a different logo on a laptop. */}
          <span className="block">{HEADLINE[0]}</span>
          <span className="block">{HEADLINE[1]}</span>
          <span className="block">{HEADLINE[2]}</span>
        </h1>

        {/* The hero's one exit. Solid page-ground rather than an outline: on a
            photograph a ghost button is the first thing to disappear, and this
            is the only click target on the screen. Not Volt — that token is
            spoken for by the authenticity eyebrow and the discount badge
            (globals.css), and a CTA is exactly the "anything the accent already
            owns" it is told to stay out of. */}
        <Link
          href={localePath(lng, "/products")}
          className="sf-body mt-9 inline-flex h-12 items-center justify-center rounded-(--sf-radius) bg-(--sf-bg) px-9 text-xs font-medium uppercase tracking-[0.14em] text-(--sf-text) shadow-[0_10px_34px_rgba(0,0,0,0.35)] transition-colors hover:bg-(--sf-hover) md:mt-11 md:h-14 md:px-11 md:text-sm"
        >
          {t("hero.cta")}
        </Link>

        {/* The homepage's only localised, keyword-bearing sentence. Visually
            gone, deliberately still in the document: it is what a crawler and
            a screen reader get instead of an English wordmark. */}
        <p className="sr-only">{t("hero.title")}</p>
      </div>
    </section>
  );
}
