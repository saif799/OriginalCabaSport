/**
 * What counts as an acceptable source image, and how much of it is worth
 * keeping (ADR-0007).
 *
 * Its own module, not part of lib/images/transform.ts, because the uploader is
 * a client component and transform.ts pulls in sharp, the S3 client and the
 * bucket. Everything here is a plain constant or a pure predicate over what
 * sharp already read, so both sides can share it — and so the judgement calls
 * the pipeline makes are readable, and testable, without encoding anything.
 *
 * The judgement is one sentence: an encode is worth running when it saves bytes
 * a customer would feel, and not when it only spends quality. Which is why the
 * decision is made *after* the encode, against its measured size, rather than
 * predicted from the source's.
 */

/**
 * svg and gif were dropped from the old allowlist: an SVG cannot meaningfully
 * become three raster widths and is a stored-XSS vector on a public bucket, and
 * sharp flattens an animated GIF to its first frame. Neither is a shoe photo.
 */
export const ACCEPTED_UPLOAD_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

/** The same list, shaped for an <input type="file"> accept attribute. */
export const ACCEPTED_UPLOAD_ACCEPT_ATTR = "image/jpeg,image/png,image/webp,image/avif";

/**
 * Ceiling on what reaches sharp. The browser hands over at most a ~250 KB
 * downscale or a file it judged already small (lib/images/downscale.ts), so
 * this only catches the fallback path and a client that could not downscale — and it must stay under Vercel's 4.5 MB
 * request body limit for Node functions.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * The line between "worth re-encoding" and "already small". ADR-0007 draws it
 * at 300 KB for the backfill — the hand-optimised rows sit at 30-50 KB and the
 * camera JPEGs start around 500 KB — and the browser uses the same number for
 * the same reason: below it, a re-encode before upload costs a generation of
 * quality and saves upstream bytes nobody was going to notice.
 *
 * A *batch* line, not a serving one. What the write-time pipeline stores is
 * decided by `QUALITY_BUDGET_BYTES` against a measured encode, because 300 KB
 * is far more than a rendition should ever weigh.
 */
export const ALREADY_SMALL_BYTES = 300 * 1024;

/** True when re-encoding these bytes would buy less than it costs. */
export function isAlreadySmall(bytes: number): boolean {
  return bytes <= ALREADY_SMALL_BYTES;
}

/**
 * What a generation of quality is worth, in bytes.
 *
 * Every rendition is encoded, and the result is the baseline. Anything better
 * to serve — the source bytes untouched, or a lossless encode — is stored
 * *instead* when it costs no more than this over that baseline. Bigger than
 * this and the saving is one a customer on Algerian mobile would feel, which is
 * what the pipeline exists for.
 *
 * Measured against the numbers in ADR-0007: the three renditions of a real
 * 3.8 MB photo are 48/177/530 KB, and the hand-optimised uploads are 30-50 KB
 * whole. So 50 KB spares an already-optimised file its second encode, and never
 * spares one whose re-encode would have halved a page.
 */
export const QUALITY_BUDGET_BYTES = 50 * 1024;

/** What the write-time pipeline knows about its input before it touches it. */
export interface SourceImage {
  bytes: number;
  /** 0 when sharp could not read it — which must never mean "fits". */
  width: number;
  /** sharp's format name — `"webp"`, `"jpeg"`, ... */
  format?: string;
  /** EXIF orientation tag, if the source carries one. */
  orientation?: number;
  /** Frames. Above 1 for an animated webp. */
  pages?: number;
}

/**
 * True when the source bytes are a legal body for the rendition at
 * `renditionWidth` — i.e. storing them verbatim would be storing the same
 * picture, only without a generation of loss.
 *
 * It says nothing about size; `QUALITY_BUDGET_BYTES` settles that against the
 * encode that was actually run. What it settles is sameness:
 *
 * - **already webp** — the key ends `.webp` and so must the bytes under it;
 * - **would not be resized** — `withoutEnlargement` leaves a source narrower
 *   than the rendition at its own pixels, so the encode changes nothing but the
 *   quality. Where the source *is* downsized the encode is doing the work the
 *   renditions exist for, and its bytes are the point. A width of 0 is sharp
 *   telling us it does not know, which is not permission to skip the encode;
 * - **nothing to bake in** — reused bytes skip `.rotate()`, so a source that is
 *   only upright because of its EXIF tag would be stored sideways forever;
 * - **not animated** — sharp flattens an animated webp to its first frame, so
 *   reusing it here and encoding it at a narrower width would leave one image
 *   that animates or not depending on the viewport. ADR-0007 dropped gif over
 *   the same flattening; webp is made to match it rather than be the exception.
 */
export function reusesSourceAt(source: SourceImage, renditionWidth: number): boolean {
  return (
    source.format === "webp" &&
    source.width > 0 &&
    source.width <= renditionWidth &&
    (source.orientation ?? 1) === 1 &&
    (source.pages ?? 1) === 1
  );
}

/**
 * True when a lossless encode is worth attempting.
 *
 * png is the one lossless format we accept: a logo or a brand image, where q70
 * artefacts sit around type and flat colour and are exactly what gets looked
 * at. There is nothing to preserve in a jpeg, webp or avif — the generation is
 * already spent — and `ALREADY_SMALL_BYTES` keeps a lossless encode of a large
 * photographic png out of a request the owner is waiting on. Whether the result
 * is *stored* is still `QUALITY_BUDGET_BYTES`' call.
 */
export function triesLosslessEncode(source: SourceImage): boolean {
  return source.format === "png" && isAlreadySmall(source.bytes);
}

/** True when `candidate` is worth storing over the `lossy` encode it beats on quality. */
export function withinQualityBudget(candidateBytes: number, lossyBytes: number): boolean {
  return candidateBytes - lossyBytes <= QUALITY_BUDGET_BYTES;
}
