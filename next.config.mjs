/**
 * The hostname R2 serves objects from, read off `R2_PUBLIC_URL` so the
 * `remotePatterns` allowlist below cannot drift from what `buildR2PublicUrl`
 * actually writes into the database (lib/r2.ts).
 *
 * Falls back to `null` rather than throwing: `next.config.mjs` is evaluated by
 * tooling that has no `.env` — `next lint`, an editor's TS server — and a throw
 * there is a confusing way to report a missing variable. A real build without
 * it fails visibly instead, at the first <Image> that 400s on an unconfigured
 * host.
 */
function r2Hostname() {
  const raw = process.env.R2_PUBLIC_URL ?? process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (!raw?.trim()) return null;
  try {
    return new URL(raw.trim()).hostname;
  } catch {
    return null;
  }
}

const R2_HOSTNAME = r2Hostname();

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    /**
     * Vercel's image optimizer, not a custom loader (ADR-0008).
     *
     * Uploads used to be resized at write time into three stored webp
     * Renditions, which meant sharp in the deployed runtime — a native addon
     * whose libvips lives in a separate package reached by ELF RPATH, which
     * output file tracing cannot see and pnpm's layout cannot hand to Vercel
     * intact. Three deploys died on it. Resizing on read removes the binary,
     * the tracing config and the custom loader together.
     *
     * Transformations bill per source image and are edge-cached, so the cost is
     * bounded by catalog size (~380 images) rather than by traffic.
     */
    remotePatterns: R2_HOSTNAME
      ? [{ protocol: "https", hostname: R2_HOSTNAME }]
      : [],
    /**
     * A year, against a default of 4 hours.
     *
     * This is what a transformation is billed on: an expired entry is
     * re-transformed and charged again, so the default would re-bill the entire
     * catalog six times a day. An R2 key carries a fresh uuid per upload and is
     * never rewritten — the objects themselves are stored
     * `max-age=31536000, immutable` — so there is nothing for a short TTL to
     * catch. Replacing an image writes a new key, which is a new URL, which
     * misses this cache by construction.
     */
    minimumCacheTTL: 31536000,
    /**
     * Trimmed from Next's defaults, which run to 3840. Every width here is a
     * separate billable transformation of every image, and
     * `CLIENT_MAX_EDGE` (lib/images/downscale.ts) caps the stored source at
     * 2000px — so the 2048 and 3840 entries would bill for widths that cannot
     * exist. These four cover the storefront's breakpoints; `imageSizes`
     * covers the admin thumbnails.
     */
    deviceSizes: [640, 828, 1080, 1920],
    imageSizes: [128, 256, 384],
  },
}

export default nextConfig
