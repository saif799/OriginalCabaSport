import { v4 as uuidv4 } from "uuid";

/**
 * The rendition key convention (ADR-0007).
 *
 * An uploaded photograph is stored as three webp Renditions and nothing else —
 * the file that was uploaded is discarded. They are addressed *by convention*,
 * not recorded: one key is stored per image (`shoe_images.cloudflareImageId`,
 * `storefront_collections.imageKey`) and the other two are that key with the
 * width swapped. That is what lets a next/image custom loader — which receives
 * only a `src` string and cannot read the database — find them.
 *
 * The stored key ends `_800.webp` and is therefore a real, fetchable object.
 * This matters: `url` is read raw by the openGraph tags and JSON-LD schema in
 * app/(storefront)/[lng]/product/[shoeId]/page.tsx and by the admin card's plain
 * <img> in components/productCard.tsx. None of those go through the loader, so
 * a key that is not a file would 404 in three places nobody watches.
 *
 * Everything uploaded before ADR-0007 has a single file with its original
 * extension and no renditions. Every function here must pass those through
 * untouched — that is the ~327-row half of the gallery, and the failure mode is
 * a silent broken image, so it is what tests/images/renditions.test.ts spends
 * most of its assertions on.
 *
 * Pure string work, no dependencies beyond uuid: this module is imported from
 * the browser (the uploader, the loader) and the server (sharp, the backfill).
 */

/**
 * Frozen — see ADR-0007. Renditions are derived from the upload and the upload
 * is not kept, so changing this set re-derives from the 1600 and loses a
 * generation. `next.config.mjs` mirrors it as `deviceSizes`.
 */
export const RENDITION_WIDTHS = [400, 800, 1600] as const;

export type RenditionWidth = (typeof RENDITION_WIDTHS)[number];

/**
 * The width stored in `url` / `imageUrl`, and so the one served to anything
 * that bypasses the loader: social scrapers, Google's product schema, the admin
 * grid. 800 clears Facebook's 600px large-preview threshold and is ~60KB.
 */
export const DEFAULT_RENDITION_WIDTH: RenditionWidth = 800;

/**
 * Anchored at the end so it matches a bare key and a full public URL alike, and
 * enumerating the three widths rather than `\d+` on purpose: 43 pre-existing
 * rows end in `_<digits>.webp` from hand-optimising, and only the widths we
 * actually write may be rewritten.
 */
const RENDITION_SUFFIX = /_(400|800|1600)\.webp$/;

/** Trailing file extension, if any. */
const EXTENSION = /\.[^./]+$/;

/**
 * A trailing width that would make a user's filename look like one of our
 * renditions. Stripped at key construction — see `keyLeaf`.
 */
const MIMICS_RENDITION = /_(400|800|1600)$/;

/** Splits a ref into `path` and everything from `?` or `#` on. */
function splitQuery(ref: string): [string, string] {
  const cut = ref.search(/[?#]/);
  return cut === -1 ? [ref, ""] : [ref.slice(0, cut), ref.slice(cut)];
}

/** True when `ref` (a key or a public URL) names one of our renditions. */
export function isRenditionRef(ref: string): boolean {
  return RENDITION_SUFFIX.test(splitQuery(ref)[0]);
}

/**
 * The shared prefix the three renditions hang off, or null if `ref` is a legacy
 * single file. Strips only the trailing suffix, so an upload of `shoe_800.webp`
 * (base `…-shoe_800`, rendition `…-shoe_800_400.webp`) resolves correctly.
 */
export function renditionBase(ref: string): string | null {
  const [path] = splitQuery(ref);
  return RENDITION_SUFFIX.test(path) ? path.replace(RENDITION_SUFFIX, "") : null;
}

/** The key (or URL) of one rendition of `base`. */
export function renditionRef(base: string, width: RenditionWidth): string {
  return `${base}_${width}.webp`;
}

/**
 * Every R2 object backing one image — three keys for a rendition set, or the
 * single key itself for a legacy row. This is what a delete has to remove.
 */
export function allRenditionKeys(key: string): string[] {
  const base = renditionBase(key);
  if (!base) return [key];
  return RENDITION_WIDTHS.map((w) => renditionRef(base, w));
}

/** The smallest rendition that covers `width`, clamped to the largest we store. */
export function nearestRenditionWidth(width: number): RenditionWidth {
  return RENDITION_WIDTHS.find((w) => w >= width) ?? RENDITION_WIDTHS[RENDITION_WIDTHS.length - 1];
}

/**
 * The loader rule. Rewrites a rendition ref to the width that fits, and returns
 * anything else — legacy uploads, `/placeholder.svg`, an empty src — exactly as
 * given. Total by construction: there is no input it can turn into a 404.
 */
export function withRenditionWidth(ref: string, width: number): string {
  const [path, tail] = splitQuery(ref);
  const base = renditionBase(path);
  if (!base) return ref;
  return `${renditionRef(base, nearestRenditionWidth(width))}${tail}`;
}

/**
 * Sanitises a filename into the `<uuid>-<name>` leaf of an R2 key.
 *
 * The single definition of what a key leaf looks like — `getPresignedUploadUrl`
 * builds its keys through this too, so the fallback path and the rendition path
 * cannot drift apart.
 *
 * `MIMICS_RENDITION` is why it is shared. A user file genuinely named
 * `photo_800.webp` would otherwise produce the key `<uuid>-photo_800.webp`,
 * which `isRenditionRef` matches — and the loader would then serve
 * `<uuid>-photo_400.webp`, an object nobody ever wrote. 43 existing rows already
 * end in `_<digits>.webp` from hand-optimising, so this is not hypothetical; it
 * is only luck that none of them uses 400, 800 or 1600.
 */
function keyLeaf(filename: string, { keepExtension }: { keepExtension: boolean }): string {
  const stem = filename.replace(EXTENSION, "");
  const extension = keepExtension ? filename.slice(stem.length) : "";
  const safeStem = stem.replace(MIMICS_RENDITION, "").replace(/[^a-zA-Z0-9.-]/g, "_");
  return `${uuidv4()}-${safeStem}${extension}`;
}

/** Joins a sanitised leaf onto a folder, tolerating stray slashes. */
function joinKey(folder: string, leaf: string): string {
  const cleanFolder = folder.replace(/^\/+|\/+$/g, "");
  return cleanFolder ? `${cleanFolder}/${leaf}` : leaf;
}

/**
 * The base key for a new upload: `<folder>/<uuid>-<name>`, with the source
 * extension dropped because the base is not a file — only its renditions are.
 */
export function buildRenditionBaseKey(folder: string, filename: string): string {
  return joinKey(folder, keyLeaf(filename, { keepExtension: false }));
}

/**
 * The key for an object stored as-is, extension and all: the presigned
 * fallback, which uploads an untransformed original.
 */
export function buildSingleObjectKey(folder: string, filename: string): string {
  return joinKey(folder, keyLeaf(filename, { keepExtension: true }));
}
