import { v4 as uuidv4 } from "uuid";

/**
 * R2 key construction, and what is left of the ADR-0007 rendition convention.
 *
 * ADR-0008 stopped writing Renditions: an upload is now one object, resized on
 * read by Vercel's image optimizer. New keys keep their extension and are built
 * by `buildSingleObjectKey`.
 *
 * The rendition half cannot simply be deleted. 116 rows were written while
 * ADR-0007 was in force: each stores a key ending `_800.webp` and has an `_400`
 * and `_1600` sibling in the bucket that no database column records. Serving
 * them is fine — a stored `_800.webp` key is a real object and just a URL now —
 * but *deleting* one has to find the other two, which is what
 * `allRenditionKeys` is for and the only reason the convention survives here.
 *
 * Pure string work, no dependencies beyond uuid: imported from the browser (the
 * uploader) and the server (the write path, lib/r2.ts).
 */

/** The widths ADR-0007 wrote. Historical: nothing writes these any more. */
const RENDITION_WIDTHS = [400, 800, 1600] as const;

type RenditionWidth = (typeof RENDITION_WIDTHS)[number];

/**
 * Anchored at the end so it matches a bare key and a full public URL alike, and
 * enumerating the three widths rather than `\d+` on purpose: 43 rows predating
 * ADR-0007 end in `_<digits>.webp` from hand-optimising, and only the widths we
 * actually wrote may be expanded into siblings.
 */
const RENDITION_SUFFIX = /_(400|800|1600)\.webp$/;

/** Trailing file extension, if any. */
const EXTENSION = /\.[^./]+$/;

/**
 * A trailing width that would make a user's filename look like one of the
 * ADR-0007 renditions. Stripped at key construction — see `keyLeaf`.
 */
const MIMICS_RENDITION = /_(400|800|1600)$/;

/** Splits a ref into `path` and everything from `?` or `#` on. */
function splitQuery(ref: string): [string, string] {
  const cut = ref.search(/[?#]/);
  return cut === -1 ? [ref, ""] : [ref.slice(0, cut), ref.slice(cut)];
}

/**
 * The shared prefix the three ADR-0007 renditions hang off, or null if `ref` is
 * a single-object key. Strips only the trailing suffix, so a key of
 * `…-shoe_800_800.webp` resolves to the base `…-shoe_800`.
 */
function renditionBase(ref: string): string | null {
  const [path] = splitQuery(ref);
  return RENDITION_SUFFIX.test(path) ? path.replace(RENDITION_SUFFIX, "") : null;
}

/** The key of one ADR-0007 rendition of `base`. */
function renditionRef(base: string, width: RenditionWidth): string {
  return `${base}_${width}.webp`;
}

/**
 * Every R2 object backing one image — the single key itself, or the three keys
 * of a row written under ADR-0007. This is what a delete has to remove.
 *
 * Total by construction: a key it does not recognise comes back as itself, so
 * it is correct for the pre-ADR-0007 rows, the ADR-0007 rows, and everything
 * written since.
 */
export function allRenditionKeys(key: string): string[] {
  const base = renditionBase(key);
  if (!base) return [key];
  return RENDITION_WIDTHS.map((w) => renditionRef(base, w));
}

/**
 * Sanitises a filename into the `<uuid>-<name>` leaf of an R2 key.
 *
 * `MIMICS_RENDITION` is why this is one shared definition. A user file named
 * `photo_800.webp` would otherwise produce the key `<uuid>-photo_800.webp`,
 * which `allRenditionKeys` reads as an ADR-0007 rendition set — so deleting it
 * would issue deletes for two siblings that were never written. Harmless today
 * because the uuid scopes it, but it is a lie in the key space and costs
 * nothing to avoid.
 */
function keyLeaf(filename: string): string {
  const stem = filename.replace(EXTENSION, "");
  const extension = filename.slice(stem.length);
  const safeStem = stem.replace(MIMICS_RENDITION, "").replace(/[^a-zA-Z0-9.-]/g, "_");
  return `${uuidv4()}-${safeStem}${extension}`;
}

/** Joins a sanitised leaf onto a folder, tolerating stray slashes. */
function joinKey(folder: string, leaf: string): string {
  const cleanFolder = folder.replace(/^\/+|\/+$/g, "");
  return cleanFolder ? `${cleanFolder}/${leaf}` : leaf;
}

/**
 * The key for a stored object, extension and all: every upload since ADR-0008,
 * and the presigned fallback before it.
 */
export function buildSingleObjectKey(folder: string, filename: string): string {
  return joinKey(folder, keyLeaf(filename));
}
