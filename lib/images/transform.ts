/**
 * The upload write path (ADR-0008): one source buffer in, one R2 object out.
 *
 * This module used to encode three webp Renditions with sharp at upload time
 * (ADR-0007). It no longer does. Resizing happens on read, in Vercel's image
 * optimizer, which `next/image` reaches through `remotePatterns` in
 * next.config.mjs — so there is no image processing in the deployed runtime and
 * no native binary to get onto Vercel.
 *
 * What survives from ADR-0007 is the half that was never about sharp: the
 * browser still downscales to 2000px before posting (lib/images/downscale.ts),
 * which protects Algerian mobile upstream and keeps the request under Vercel's
 * 4.5 MB body limit. That is why the object stored here is a ~250 KB webp
 * rather than a 3.8 MB camera JPEG.
 *
 * Server-side only — the S3 client. What the browser also needs, the accepted
 * source types and the size ceiling, lives in lib/images/source.ts.
 *
 * No `import "server-only"`: that marker throws under plain `tsx`, and the
 * scripts in lib/scripts/ run this module's neighbours the same way.
 */

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { buildR2PublicUrl, deleteR2Object, getR2Client } from "@/lib/r2";
import { allRenditionKeys, buildSingleObjectKey } from "@/lib/images/renditions";

export interface WrittenImage {
  /** The R2 object key stored on the row. */
  key: string;
  /** Public URL of that object. */
  url: string;
}

/**
 * Stores `source` as a single R2 object and returns the key to persist.
 *
 * The bytes are stored exactly as uploaded. There is no re-encode, so there is
 * no generation of loss and no server-side encode budget — which is the whole
 * point of moving resizing to read time.
 *
 * EXIF orientation is *not* baked in here, because nothing on the server reads
 * pixels any more. On the normal path the browser already baked it
 * (`imageOrientation: "from-image"` in lib/images/downscale.ts), and Vercel's
 * optimizer auto-rotates what it serves. The gap is the raw `url`, which the
 * openGraph tags, JSON-LD and the admin card's plain <img> read without going
 * through the optimizer: a file that reached the presigned fallback untouched
 * and is only upright because of its orientation tag will sit sideways in those
 * three places. Rare enough to accept — see ADR-0008.
 */
export async function writeImage(
  source: Buffer,
  {
    folder,
    filename,
    contentType,
  }: { folder: string; filename: string; contentType: string },
): Promise<WrittenImage> {
  const bucketName = process.env.R2_BUCKET_NAME;
  if (!bucketName) {
    throw new Error("R2_BUCKET_NAME is not configured in environment variables");
  }

  const key = buildSingleObjectKey(folder, filename);

  await getR2Client().send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: contentType,
      Body: source,
      // Every upload gets a fresh uuid in its key, so an object is never
      // rewritten and may be cached forever.
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  return { key, url: buildR2PublicUrl(key) };
}

/**
 * Deletes every R2 object backing one image.
 *
 * Usually one object. It stays plural because of the 116 rows written during
 * ADR-0007, whose key ends `_800.webp` and has an `_400` and `_1600` sibling
 * that nothing records — `allRenditionKeys` is what still finds them, and
 * dropping it would leak two objects per delete for that half of the gallery.
 */
export async function deleteImage(key: string): Promise<void> {
  await Promise.all(allRenditionKeys(key).map((k) => deleteR2Object(k)));
}
