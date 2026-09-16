# ADR-0008: Uploaded images are resized on read, by Vercel's optimizer

**Status:** accepted, 2026-09-16
**Supersedes:** [ADR-0007](0007-uploaded-images-are-transformed-at-write-time.md)

## Context

ADR-0007 resized at write time: an upload became three webp Renditions (400 /
800 / 1600) stored in R2, addressed by a key convention, served through an
`images.loader: "custom"` that picked the one that fit. Nothing was transformed
on read, so serving cost nothing beyond storage.

It required sharp in the deployed runtime, and sharp could not be deployed.
Three failures in a row:

1. `ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.6`. sharp's addon is only a binding;
   on linux libvips is a separate package reached through an ELF RPATH, not a
   `require`. Output file tracing follows the module graph, so it shipped the
   addon and left libvips behind.
2. Adding `outputFileTracingIncludes` produced *"The framework produced an
   invalid deployment package for a Serverless Function"* — under pnpm's
   isolated layout the only copy of libvips satisfying the RPATH sits behind a
   symlinked sibling in `.pnpm/`, and Vercel rejects a function whose files come
   from a symlinked directory.
3. Pinning `nodeLinker: hoisted` did not fix it either.

Each attempt passed every local check and failed only on Vercel. The shape of
the problem is general: **a native binary with an out-of-band shared library is
fragile to deploy from pnpm on Vercel**, and it stays fragile across every
future sharp and Next upgrade.

## Decision

Stop transforming images at write time. An upload is stored as **one R2
object**, exactly as the browser posted it, and `next/image` resizes on read
through Vercel's built-in image optimizer, reached by a `remotePatterns` entry
for the R2 public hostname.

Consequently:

- `images.loader: "custom"` and `lib/images/loader.ts` are gone, and with them
  the hand-written `turbopack.resolveAlias` that existed only because Turbopack
  ignores `loaderFile`.
- `outputFileTracingIncludes`, `serverExternalPackages: ["sharp"]` and
  `scripts/check-sharp-trace.mjs` are deleted — all three existed only to keep
  sharp deployable.
- sharp moves to `devDependencies`. It does not leave the repo:
  `lib/scripts/generateBrandImages.ts` draws the share cards with librsvg
  through sharp, runs locally under `tsx`, and commits its output.
- `lib/scripts/backfillImageRenditions.ts` is deleted; there is nothing to
  backfill.
- The Quality Budget (ADR-0007 §8) is gone. It decided which of several encodes
  to store; there is no encode on the server to choose between.

**The browser downscale in `lib/images/downscale.ts` survives, and matters
more.** It never existed for `next/image`'s benefit — it protects Algerian
mobile upstream and keeps the request under Vercel's 4.5 MB body limit. Now that
nothing re-encodes downstream, `CLIENT_MAX_EDGE` (2000px) is the ceiling on what
the storefront can serve and `CLIENT_WEBP_QUALITY` is the only quality setting
in the whole upload path.

## Why this over the alternatives

A WASM encoder (`@jsquash/webp`) keeps ADR-0007 intact but is materially slower
than sharp, and the owner's budget for an upload is ~2s — three WASM encodes do
not fit. Emitting all three widths in the browser fits the deployment
constraint but triples the client-side encode on the phone that took the photo,
for the same 2s. Resizing on read does **zero** encoding at upload, which makes
it the fastest of the three as well as the smallest.

Cloudflare Images was considered and rejected: the owner wants R2 to stay dumb
storage rather than grow a second vendor's processing surface.

## Costs, accepted

- **Transformations are billed per source image.** They are edge-cached and
  re-billed only when the cache TTL lapses, so the bill is bounded by catalog
  size — ~380 images × the widths actually requested — and does **not** scale
  with traffic. Growing the catalog grows it; growing the store does not.
- **R2's immutable cache headers no longer reach the browser**, and a cache miss
  costs a fetch hop from Vercel back to R2.
- **EXIF orientation is no longer baked in server-side.** On the normal path the
  browser already did it (`imageOrientation: "from-image"`), and the optimizer
  auto-rotates what it serves. The gap is the raw `url` column, which the
  openGraph tags, the JSON-LD and the admin card's plain `<img>` read *without*
  going through the optimizer: a file that reached the presigned fallback
  untouched and is upright only because of its orientation tag will sit sideways
  in those three places. Rare — it needs a browser that cannot downscale *and* a
  tagged original — and not worth a native binary to close.

## What the old rows do

Nothing. All three generations keep working untouched:

- the ~261 rows predating ADR-0007 — a single object with its original
  extension, exactly what the new scheme writes;
- the 116 rows written under ADR-0007 — the stored key ends `_800.webp` and is a
  real, fetchable object. With nothing resolving renditions from it any more it
  is simply a URL, the same way the pre-ADR-0007 rows already were;
- everything written since.

The one piece of the convention that **must** survive is `allRenditionKeys` in
`lib/images/renditions.ts`. Those 116 rows have an `_400` and `_1600` sibling in
the bucket that no database column records, so a delete has to expand the key to
find them. Dropping it would leak two orphaned objects per delete for that half
of the gallery. `tests/images/renditions.test.ts` pins its totality over all
three generations.

The `_400` and `_1600` siblings are otherwise dead bytes. They are left in place
deliberately: R2 storage is cheap, and a bulk delete is a destructive one-way
operation whose only benefit is a few megabytes.
