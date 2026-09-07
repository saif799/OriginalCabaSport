# ADR 0007: Uploaded Images Are Transformed at Write Time

## Status
Accepted.

## Context

`next.config.mjs` set `images.unoptimized: true`, which makes every `<Image>` in the storefront a passthrough: no resize, no format negotiation, no `srcset`. Nothing else compensated, so whatever the owner uploaded is exactly what a customer downloaded.

Measured before this decision, across 375 `shoe_images` rows and 3 Collections:

- **116 images are over 300 KB, totalling 282 MB.** They are camera JPEGs (`IMG_0606.jpeg` and friends) at up to **3.8 MB** and 4032x3024, spread through the whole table rather than concentrated in recent uploads. One of them is the Ja Morant Collection card at 2.3 MB — i.e. the homepage.
- The rest were hand-optimised to webp/avif at **30–50 KB** before upload. The owner was doing this by hand, and stopped.
- A products grid of 12 cards therefore shipped ~16 MB, to customers on Algerian mobile.
- R2 objects return **no `Cache-Control` header**, and `R2_PUBLIC_URL` is `pub-<hash>.r2.dev` — Cloudflare's development URL, which is rate-limited, cannot carry cache rules, and does not support Image Transformations.

Both upload paths presigned and `PUT` browser→R2 directly, so no server code ever held the bytes.

## Decision

**Images are resized once, at upload, and the uploaded file is not kept.**

1. **The browser downscales first.** Selected files are decoded with `createImageBitmap(file, { imageOrientation: "from-image" })` — EXIF orientation must be applied here, because re-encoding to webp discards it — resized to a 2000 px long edge and encoded to webp. A 3.8 MB camera photo leaves the phone at ~250 KB.
2. **One hop, not two.** That file is `POST`ed to `/api/r2/upload`, which runs `sharp` inline. The presigned direct-to-R2 path is demoted to a fallback for browsers that cannot downscale. It existed only to dodge Vercel's 4.5 MB function body limit, and a downscaled file is nowhere near it.
3. **Three renditions, webp, 400 / 800 / 1600**, aspect ratio preserved, never enlarged, written with `Cache-Control: public, max-age=31536000, immutable`. Quality is q72/70/68 — measured, not guessed: on a real 3.8 MB upload that yields 48 / 177 / 530 KB, and a catalog card pulls the 400, so the grid goes from ~16 MB to under 1 MB.
4. **The uploaded file is deleted.** Only the renditions are stored.
5. **Renditions are addressed by convention, not recorded.** The stored key and url end `_800.webp`; `_400` and `_1600` are the same key with the width swapped. No schema change, no new table, no join.
6. **`next/image` gets a custom loader** (`images.loader: "custom"`, `deviceSizes: [400, 800, 1600]`), which swaps that width. `images.unoptimized` is removed.
7. **The same pipeline serves Collection images** (`storefrontCollections.imageKey`), which are the homepage.

The 116 oversized images are backfilled through the same entry point, selected by size rather than a hardcoded list, in two phases: derive and repoint, then purge the originals in a second run once the result has been eyeballed. The rows already under 300 KB are left alone — re-encoding them costs a generation of quality and saves nothing.

## Considered options

- **Read-path optimisation** — leave originals fat, set `images.unoptimized: false` and let Vercel's optimizer resize on demand. One line. Rejected: it leaves 65 MB of unusable bytes in the bucket, pulls every 3.8 MB original through Vercel once per variant, is billed per transformation, and is a metered dependency on the host for a problem fixable once at write time. `components/storefront/Hero.tsx` already ships static sharp derivatives; this keeps one pattern in the repo instead of two.
- **Cloudflare Image Transformations** — the same read-path shape, on the CDN. Rejected *for now*: it requires a zone, and the bucket is on `r2.dev`. Binding a custom domain is wanted independently (cache rules, rate limits) and does not conflict with this decision.
- **Server-side transform after a presigned upload** — keep the current upload code, then GET the object back, sharp it, and delete it. Rejected: it spends a 3.8 MB upload on a file that is deleted minutes later, and the upload wait is the part the owner actually sits through.
- **Routing every upload through `/api/r2/upload` with no client downscale.** Rejected: Vercel caps Node function request bodies at 4.5 MB and the largest observed file is 3.8 MB. A 5 MB photo would 413 with no fallback left, because `/api/r2/upload` *is* today's fallback.
- **`browser-image-compression`** for the client-side step. Reasonable, and declined: the client resize only has to be good enough for sharp to finish the job, and ~40 lines of `createImageBitmap` + `OffscreenCanvas` avoids a dependency and its bundle weight.
- **Recording renditions in a `jsonb` column or a `shoe_image_renditions` table.** More truthful about partial writes. Rejected because a `next/image` custom loader receives only the `src` string and cannot read the database — recording renditions means dropping `next/image` from `ProductMedia` and `ImageCarousel` for hand-built `<img srcset>`.
- **An extensionless base key** (`<uuid>-name`, renditions `<base>_400.webp`). Rejected after checking the consumers: `url` is read raw by openGraph tags (`product/[shoeId]/page.tsx:61`), by JSON-LD Product schema (`:114`, `:83`, `products/page.tsx:86`) and by the admin card's plain `<img>` (`productCard.tsx:176`). A base key is not a file, so all four would 404 — three of them silently, in social previews and search results.

## Consequences

- **The width set is frozen.** With no master, changing 400/800/1600 means re-deriving from the 1600 and losing a generation, or re-uploading. This was taken knowingly: the alternative was keeping masters that nothing reads. If the set ever needs to change, do it before the next batch of uploads, not after.
- **Legacy rows keep working, untouched.** The loader rewrites only what matches `_(400|800|1600)\.webp$`. The rows left un-backfilled, whose keys end `.jpeg` / `.webp` / `.avif`, pass through unchanged and are served exactly as they are today. They will emit a `srcset` whose entries are all the same URL — harmless, and the price of not backfilling them.
- **`Hero.tsx`'s header comment is now wrong.** It justifies avoiding `next/image` on the grounds that `images.unoptimized` is set. The Hero stays on `<picture>` — it art-directs two *different* photographs, which `next/image` cannot express — but for that reason, not the stale one.
- **Deleting a gallery image now deletes three objects**, not one. `DELETE /api/admin/images` derives the base and removes all three.
- **The upload size limit moves after the downscale.** Rejecting a 12 MB selection made no sense once the thing being uploaded is 250 KB.
- **`images.loaderFile` does not work on Turbopack**, which is what this project builds with. Next 16 applies it by aliasing `next/dist/shared/lib/image-loader`, and that alias only exists in the webpack config. `next build` still passes — the pages that render images are dynamic — and every image then throws `next-image-missing-loader` at render time. `next.config.mjs` re-creates the alias by hand under `turbopack.resolveAlias`; both halves are required, and both should be re-checked on a Next upgrade.

- **A user filename can mimic a rendition, and is defused at key construction.** 43 existing rows end in `_<digits>.webp` from hand-optimising; none happens to use 400, 800 or 1600, which is the only reason the suffix rule is safe on the data already stored. New keys are not left to luck: `keyLeaf` strips a trailing `_400`/`_800`/`_1600` from every filename, on both the rendition path and the presigned fallback — otherwise uploading `photo_800.webp` through the fallback would store a key the loader rewrites into objects nobody wrote. `RENDITION_SUFFIX` also enumerates the three widths rather than matching any number. Adding a width to the set means re-checking both.

- **This does not fix caching.** `r2.dev` ignores the `Cache-Control` now being written; it starts paying off the day a custom domain is bound to the bucket, which remains the next thing to do.
