/**
 * The shared libraries sharp's native addon dlopens, which output file tracing
 * cannot see. Listed once; applied to every route that reaches sharp below.
 */
const SHARP_NATIVE_LIBS = [
  // Two sharps are installed — ours, and the one next itself depends on — and
  // both addons get traced into these routes, so both need their libvips. One
  // wins the root hoist and the other nests; which one differs by platform
  // (next on linux, sharp on win32), hence the `*` rather than a named parent.
  "./node_modules/@img/sharp-libvips-linux-x64/lib/**",
  "./node_modules/*/node_modules/@img/sharp-libvips-linux-x64/lib/**",
  // win32 pulls nothing on Vercel. It is here so a local `pnpm build` proves
  // the include still reaches a native library at all, on the one platform
  // where that can be checked without deploying. scripts/check-sharp-trace.mjs
  // is what reads the result.
  "./node_modules/@img/sharp-win32-x64/lib/**",
  "./node_modules/*/node_modules/@img/sharp-win32-x64/lib/**",
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // sharp ships native binaries and must not be traced into the bundle.
  serverExternalPackages: ["sharp"],
  /**
   * Load-bearing. Without these, every sharp route 500s in production with
   * `ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.6: cannot open shared object file`.
   *
   * Output file tracing decides which files are copied into each deployed
   * function. It follows `require`, so it finds sharp's native addon —
   * `@img/sharp-linux-x64/lib/sharp-linux-x64.node` — and puts it in the
   * bundle. But the addon is only the binding: libvips itself lives in a
   * separate package, `@img/sharp-libvips-linux-x64`, and the addon reaches it
   * at load time through an ELF RPATH, not a `require`. Nothing in the module
   * graph points at that file, so tracing leaves it behind and the addon
   * dlopens a library that was never deployed. The failure is invisible
   * locally: on Windows and macOS the libvips binary sits *inside* the same
   * platform package as the addon, so only linux splits them.
   *
   * The globs name the directory, not the file, because the soname carries the
   * libvips version (`...so.8.18.6`) and moves on every sharp upgrade.
   *
   * They also assume a hoisted node_modules, which pnpm-workspace.yaml pins.
   * Under pnpm's default isolated layout the only path that satisfies the
   * RPATH runs through a symlink, and tracing files from inside a symlinked
   * directory makes Vercel reject the whole function: "The framework produced
   * an invalid deployment package for a Serverless Function." That failure is
   * at deploy time, after a clean build, so nothing local catches it —
   * `scripts/check-sharp-trace.mjs` checks the libraries are there, not that
   * the layout around them is packable.
   *
   * Keyed per route: these are the three that import lib/images/transform.ts.
   * A fourth route that starts using sharp needs its own entry here.
   */
  outputFileTracingIncludes: {
    "/api/r2/upload": SHARP_NATIVE_LIBS,
    "/api/admin/images": SHARP_NATIVE_LIBS,
    // Not "/api/admin/collections/[collectionId]" — these keys are globs, and
    // the brackets of a dynamic segment read as a character class, so that key
    // silently matches nothing.
    "/api/admin/collections/**": SHARP_NATIVE_LIBS,
  },
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
