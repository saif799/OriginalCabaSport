"use client";

/**
 * Browser-side downscale, the only place an uploaded image is re-encoded.
 *
 * A 3.8 MB camera photo leaves the phone at roughly 250 KB. Two reasons: not
 * spending Algerian mobile upstream on pixels no page will ever ask for, and
 * staying far under Vercel's 4.5 MB function body limit so `/api/r2/upload` can
 * be the normal path instead of the presigned fallback.
 *
 * It got *more* load-bearing under ADR-0008, not less. The server no longer
 * re-encodes anything, so what this produces is what R2 stores and what Vercel's
 * optimizer resizes from — CLIENT_MAX_EDGE is now the ceiling on how large an
 * image the storefront can ever serve, and CLIENT_WEBP_QUALITY is the only
 * quality setting in the upload path.
 *
 * Deliberately hand-rolled rather than a package: ~40 lines, and the admin
 * bundle does not need another dependency for it.
 *
 * EXIF orientation is load-bearing. Re-encoding to webp discards EXIF, so an
 * iPhone photo that was only ever upright *because* of its orientation tag
 * lands sideways forever unless it is baked in here — hence
 * `imageOrientation: "from-image"`.
 *
 * Every failure path returns the original File. The caller falls back to the
 * presigned upload, which still works on a full-size original.
 */

import { isAlreadySmall } from "@/lib/images/source";

/**
 * Long edge of the stored object. This is the largest source Vercel's optimizer
 * will ever have to work from, so it caps what any viewport can be served.
 */
export const CLIENT_MAX_EDGE = 2000;

/** Generous, because nothing downstream re-encodes: artefacts here are permanent. */
const CLIENT_WEBP_QUALITY = 0.9;

/** Formats a canvas can decode. HEIC is not one of them; it falls through untouched. */
const DOWNSCALABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

function canDownscale(): boolean {
  return (
    typeof createImageBitmap === "function" &&
    typeof OffscreenCanvas === "function" &&
    typeof OffscreenCanvas.prototype.convertToBlob === "function"
  );
}

/**
 * Returns a downscaled webp File, or the input File unchanged if it is already
 * small enough, not a decodable raster, or anything at all goes wrong.
 */
export async function downscaleForUpload(file: File): Promise<File> {
  if (!DOWNSCALABLE.has(file.type) || !canDownscale()) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }

  try {
    const longEdge = Math.max(bitmap.width, bitmap.height);
    const scale = longEdge > CLIENT_MAX_EDGE ? CLIENT_MAX_EDGE / longEdge : 1;

    // Nothing to resize, and little to gain. This step exists to keep a 3.8 MB
    // camera photo off Algerian mobile upstream; on a file already under
    // ALREADY_SMALL_BYTES it trades at most ~250 KB of that upstream for a
    // generation of quality that nothing downstream can give back. A png is the
    // clearest case — a logo re-encoded to lossy webp here is lossy forever. An
    // already-webp source is passed through at any size for the same reason:
    // there is no format change left to make.
    if (scale === 1 && (file.type === "image/webp" || isAlreadySmall(file.size))) {
      return file;
    }

    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await canvas.convertToBlob({
      type: "image/webp",
      quality: CLIENT_WEBP_QUALITY,
    });
    if (!blob || blob.type !== "image/webp") return file;

    // A tiny PNG logo can grow when re-encoded. Keep whichever is smaller.
    if (blob.size >= file.size && scale === 1) return file;

    const stem = file.name.replace(/\.[^./]+$/, "");
    return new File([blob], `${stem}.webp`, {
      type: "image/webp",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}
