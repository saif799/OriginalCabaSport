/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // sharp ships native binaries and must not be traced into the bundle.
  serverExternalPackages: ["sharp"],
  /**
   * Load-bearing, and NOT redundant with `images.loaderFile` below.
   *
   * Next 16 wires loaderFile up by aliasing `next/dist/shared/lib/image-loader`
   * — but only in build/create-compiler-aliases.js, which is the *webpack*
   * config. This project builds with Turbopack, where the alias never lands, so
   * loaderFile alone leaves every <Image> throwing
   * "is missing loader prop" (next-image-missing-loader) at render time. It
   * still builds clean, because the pages that render images are dynamic.
   *
   * These two lines are that same alias, done by hand. Delete them and the
   * storefront 500s. Recheck on every Next upgrade: if Turbopack starts
   * honouring loaderFile, this becomes dead weight rather than a bug.
   */
  turbopack: {
    resolveAlias: {
      "next/dist/shared/lib/image-loader": "./lib/images/loader.ts",
      "next/dist/esm/shared/lib/image-loader": "./lib/images/loader.ts",
    },
  },
  images: {
    /**
     * Uploaded images are resized once, at upload, into three stored webp
     * Renditions (ADR-0007). There is nothing to optimise on demand, so the
     * loader just picks the Rendition that fits — see lib/images/loader.ts.
     *
     * This replaces `unoptimized: true`, which made every <Image> a passthrough
     * and was the reason a 12-card grid shipped ~16 MB of camera JPEGs.
     */
    loader: "custom",
    loaderFile: "./lib/images/loader.ts",
    /**
     * Mirrors RENDITION_WIDTHS in lib/images/renditions.ts — these are the only
     * widths that exist on disk. Keep the two in step.
     */
    deviceSizes: [400, 800, 1600],
    // Empty on purpose. Next builds candidates from [...imageSizes, ...deviceSizes];
    // anything below 400 would emit an extra srcset entry pointing at the 400
    // file under a width descriptor that understates it.
    imageSizes: [],
  },
}

export default nextConfig
