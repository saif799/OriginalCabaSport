"use client";

/**
 * Browser-side downscale, the first half of the upload path in ADR-0007.
 *
 * A 3.8 MB camera photo leaves the phone at roughly 250 KB. This is not about
 * final quality — sharp does the real encoding server-side, from this file —
 * it is about not spending Algerian mobile upstream on bytes that are deleted
 * minutes later, and about staying far under Vercel's 4.5 MB function body
 * limit so `/api/r2/upload` can be the normal path instead of the fallback.
 *
 * Deliberately hand-rolled rather than a package: it only has to be good enough
 * to hand sharp something workable, and the admin bundle does not need another
 * dependency for ~40 lines.
 *
 * EXIF orientation is load-bearing. Re-encoding to webp discards EXIF, so an
 * iPhone photo that was only ever upright *because* of its orientation tag
 * lands sideways forever unless it is baked in here — hence
 * `imageOrientation: "from-image"`.
 *
 * Every failure path returns the original File. The caller falls back to the
 * presigned upload, which still works on a full-size original.
 */

/** Long edge of the intermediate handed to sharp. 25% headroom over the 1600 rendition. */
export const CLIENT_MAX_EDGE = 2000;

/** Generous: sharp re-encodes anyway, and artefacts here would be permanent. */
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

    // Already small and already webp: nothing to gain, and re-encoding would
    // only lose a generation.
    if (scale === 1 && file.type === "image/webp") return file;

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
