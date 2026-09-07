/**
 * The write-time image pipeline (ADR-0007): one source buffer in, three webp
 * Renditions in R2, nothing else stored. The source is not kept.
 *
 * This is the single entry point. The upload route and
 * lib/scripts/backfillImageRenditions.ts both call `writeRenditions`, so there
 * is one definition of what an image in this system looks like.
 *
 * Server-side only — sharp and the S3 client. What the browser also needs, the
 * accepted source types and the size ceiling, lives in lib/images/source.ts, so
 * nothing client-side has a reason to reach for this module.
 *
 * No `import "server-only"`, unlike lib/auth/guard.ts: that marker throws under
 * plain `tsx`, and lib/scripts/backfillImageRenditions.ts has to run the same
 * pipeline as the upload route. One definition of a Rendition is worth more
 * than the marker.
 */

import sharp from "sharp";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { buildR2PublicUrl, deleteR2Object, getR2Client } from "@/lib/r2";
import {
  DEFAULT_RENDITION_WIDTH,
  RENDITION_WIDTHS,
  allRenditionKeys,
  buildRenditionBaseKey,
  renditionRef,
  type RenditionWidth,
} from "@/lib/images/renditions";


/**
 * Matches the hand-cut Hero derivatives (q68-72), and measured on the real
 * uploads rather than guessed: on a 4032x3024 phone photo, q80/78/75 gives
 * 59/206/583KB and q72/70/68 gives 48/177/530KB — 11% off for no visible
 * difference, because the bytes are dominated by sensor noise, not the quality
 * setting. Dropping to q65 saves only another 10% and starts to show.
 *
 * Slightly higher at the small end: a 400px card is where artefacts actually
 * get looked at, and the file is tiny either way.
 *
 * `effort` is 4, not sharp's slower settings: 6 buys ~5% for +1.2s across the
 * three encodes, and this runs inside a request the owner is waiting on.
 */
const WEBP_QUALITY: Record<RenditionWidth, number> = { 400: 72, 800: 70, 1600: 68 };

export interface WrittenRenditions {
  /** The key stored on the row: the DEFAULT_RENDITION_WIDTH rendition, a real object. */
  key: string;
  /** Public URL of that same rendition. */
  url: string;
  /** Shared prefix of the set. */
  base: string;
  /** Every key written, smallest first. */
  keys: string[];
}

/**
 * Encodes and uploads the three renditions of `source`.
 *
 * Renditions preserve aspect ratio and are never enlarged: the product page
 * renders `object-contain` and its component comment says it never crops, so
 * cropping at write time would break it, and upscaling a small source only
 * inflates bytes.
 */
export async function writeRenditions(
  source: Buffer,
  { folder, filename }: { folder: string; filename: string },
): Promise<WrittenRenditions> {
  const bucketName = process.env.R2_BUCKET_NAME;
  if (!bucketName) {
    throw new Error("R2_BUCKET_NAME is not configured in environment variables");
  }

  const base = buildRenditionBaseKey(folder, filename);
  const client = getR2Client();

  // `.rotate()` with no argument bakes in EXIF orientation. The browser already
  // did this on the normal path, but the presigned fallback and the backfill
  // both hand us untouched originals.
  const pipeline = sharp(source).rotate();

  const encoded = await Promise.all(
    RENDITION_WIDTHS.map(async (width) => ({
      width,
      body: await pipeline
        .clone()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY[width], effort: 4 })
        .toBuffer(),
    })),
  );

  await Promise.all(
    encoded.map(({ width, body }) =>
      client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: renditionRef(base, width),
          ContentType: "image/webp",
          Body: body,
          // Renditions are immutable: a new upload gets a new uuid, never a
          // rewrite of an existing key. r2.dev ignores this today; it starts
          // paying off the day a custom domain is bound to the bucket.
          CacheControl: "public, max-age=31536000, immutable",
        }),
      ),
    ),
  );

  const key = renditionRef(base, DEFAULT_RENDITION_WIDTH);
  return {
    key,
    url: buildR2PublicUrl(key),
    base,
    keys: encoded.map(({ width }) => renditionRef(base, width)),
  };
}

/**
 * Deletes every object backing one image: three renditions, or the single file
 * of a row that predates ADR-0007.
 */
export async function deleteRenditions(key: string): Promise<void> {
  await Promise.all(allRenditionKeys(key).map((k) => deleteR2Object(k)));
}
