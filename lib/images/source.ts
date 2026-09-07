/**
 * What counts as an acceptable source image (ADR-0007).
 *
 * Its own module, not part of lib/images/transform.ts, because the uploader is
 * a client component and transform.ts pulls in sharp, the S3 client and
 * `server-only`. These are plain constants shared by both sides.
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
 * Ceiling on what reaches sharp. The browser downscales to ~250 KB first
 * (lib/images/downscale.ts), so this only catches the fallback path and a
 * client that could not downscale — and it must stay under Vercel's 4.5 MB
 * request body limit for Node functions.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
