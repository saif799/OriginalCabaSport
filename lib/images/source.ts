/**
 * What counts as an acceptable source image, and what is small enough to leave
 * alone.
 *
 * Its own module, not part of lib/images/transform.ts, because the uploader is
 * a client component and transform.ts pulls in the S3 client and the bucket.
 * Everything here is a plain constant or a pure predicate, so both sides share
 * it — the browser decides what it may offer and whether to downscale it, and
 * the route rejects on the same rules rather than a second copy of them.
 *
 * Nothing here judges *quality* any more. Under ADR-0007 it also decided which
 * encode to store; ADR-0008 moved resizing to read time, so there is no encode
 * on the server to have an opinion about.
 */

/**
 * svg and gif were dropped from the old allowlist: an SVG is a stored-XSS
 * vector on a public bucket, and an animated GIF is flattened to its first
 * frame by every resizer that will touch it. Neither is a shoe photo.
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
 * Ceiling on what the upload route will accept. The browser hands over at most
 * a ~250 KB downscale or a file it judged already small
 * (lib/images/downscale.ts), so this only catches a client that could not
 * downscale — and it must stay under Vercel's 4.5 MB request body limit for
 * Node functions.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * The line between "worth re-encoding before upload" and "already small". The
 * hand-optimised rows sit at 30-50 KB and the camera JPEGs start around
 * 500 KB, so below this a downscale in the browser costs a generation of
 * quality to save upstream bytes nobody was going to notice.
 *
 * An *upstream* line, not a serving one: what a customer is finally sent is
 * decided by Vercel's optimizer at read time (ADR-0008), not here.
 */
export const ALREADY_SMALL_BYTES = 300 * 1024;

/** True when re-encoding these bytes would buy less than it costs. */
export function isAlreadySmall(bytes: number): boolean {
  return bytes <= ALREADY_SMALL_BYTES;
}
