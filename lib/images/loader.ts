import { withRenditionWidth } from "./renditions";
import type { ImageLoaderProps } from "next/image";

/**
 * The `images.loader: "custom"` entry point (ADR-0007).
 *
 * Next calls this once per entry in `deviceSizes` to build a srcset. Our images
 * are pre-rendered at upload, so there is nothing to optimise on demand: the
 * loader just points at whichever stored Rendition covers the requested width.
 *
 * It runs for EVERY <Image> in the app, including the ~327 gallery rows that
 * predate ADR-0007 and have no renditions. `withRenditionWidth` returns those
 * untouched, so they are served exactly as they are today — their srcset is
 * three copies of one URL, which the browser handles fine.
 *
 * No "use client" here, deliberately: Next compiles `loaderFile` specially, and
 * the directive turns this module into a client reference whose default export
 * is a proxy rather than the function — which fails at runtime with
 * next-image-missing-loader, not at build time.
 *
 * `quality` is ignored on purpose. It is fixed at encode time in
 * lib/images/transform.ts; honouring it here would imply a resize we cannot do.
 */
export default function r2ImageLoader({ src, width }: ImageLoaderProps): string {
  return withRenditionWidth(src, width);
}
