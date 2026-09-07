"use client";

import { downscaleForUpload } from "@/lib/images/downscale";
import { ACCEPTED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "@/lib/images/source";

/**
 * The browser half of the ADR-0007 upload path, in one place.
 *
 * There are two uploaders — `components/ui/image-uploader.tsx` (Collections)
 * and the gallery panel in `ProductEditClient` — and they used to carry their
 * own copy of this sequence. They drifted: one rejected oversized files that
 * the other happily fell back with. One definition now, so a change to the
 * upload contract is one edit.
 *
 * The sequence:
 *
 *   1. Downscale in the browser (~250 KB out of a 3.8 MB camera photo).
 *   2. POST it to /api/r2/upload, where sharp writes the three Renditions.
 *   3. On failure, presign and PUT the *original* direct to R2 — a legacy
 *      single object with no Renditions, which the image loader passes through.
 *
 * Step 3 is also taken directly, skipping step 2, when the browser could not
 * downscale and the original is over the server's limit. Posting it would only
 * earn a 413. That case is the entire reason the presigned path still exists.
 */

/** One finished upload: the R2 object key and the public URL built from it. */
export interface UploadedObject {
  key: string;
  url: string;
}

export interface UploadImageOptions {
  /** R2 subfolder, e.g. `products/shoes/<shoeId>`. */
  folder: string;
  /** Bytes-sent progress, 0-100. Capped below 100 until the server responds. */
  onProgress?: (percent: number) => void;
}

/** Thrown for a file we will not attempt at all. Safe to show to the user. */
export class UnsupportedImageError extends Error {
  constructor(filename: string) {
    super(`"${filename}" is not a supported image (JPEG, PNG, WebP or AVIF).`);
    this.name = "UnsupportedImageError";
  }
}

export async function uploadImageFile(
  file: File,
  { folder, onProgress }: UploadImageOptions,
): Promise<UploadedObject> {
  if (!ACCEPTED_UPLOAD_TYPES.has(file.type)) {
    throw new UnsupportedImageError(file.name);
  }

  const prepared = await downscaleForUpload(file);

  // `downscaleForUpload` returns the input unchanged when it cannot decode the
  // file. If that untouched original is also too big for the function body
  // limit, the server route cannot help — go straight to the fallback rather
  // than spend the upload on a guaranteed 413.
  if (prepared.size > MAX_UPLOAD_BYTES) {
    return uploadViaPresignedUrl(file, folder, onProgress);
  }

  try {
    return await uploadViaServer(prepared, folder, onProgress);
  } catch (serverError) {
    console.warn("Server upload failed, falling back to presigned URL:", serverError);
    return uploadViaPresignedUrl(file, folder, onProgress);
  }
}

/**
 * XHR rather than fetch purely for the progress event. This used to be the
 * silent fallback behind a presigned PUT; losing the progress bar when it
 * became the normal path would be a regression on the screen being watched.
 */
function uploadViaServer(
  file: File,
  folder: string,
  onProgress?: (percent: number) => void,
): Promise<UploadedObject> {
  return new Promise<UploadedObject>((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("folder", folder);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/r2/upload", true);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        // Capped at 99: the bytes are up, but sharp has yet to run.
        onProgress?.(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    };

    xhr.onload = () => {
      let data: { key?: string; publicUrl?: string; error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* handled by the status check below */
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.key && data.publicUrl) {
        onProgress?.(100);
        resolve({ key: data.key, url: data.publicUrl });
      } else {
        reject(new Error(data.error || `Upload failed (${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(formData);
  });
}

/** Uploads the untransformed original. Stores one object, no Renditions. */
async function uploadViaPresignedUrl(
  file: File,
  folder: string,
  onProgress?: (percent: number) => void,
): Promise<UploadedObject> {
  const res = await fetch("/api/r2/presigned-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType: file.type, folder }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Presign failed (${res.status})`);
  }

  const { uploadUrl, key, publicUrl } = await res.json();

  return new Promise<UploadedObject>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl, true);
    xhr.setRequestHeader("Content-Type", file.type);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve({ key, url: publicUrl });
      } else {
        reject(new Error(`Direct upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network/CORS error during direct upload"));
    xhr.send(file);
  });
}
