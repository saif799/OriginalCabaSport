import { requireAdmin } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { ACCEPTED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "@/lib/images/source";
import { writeImage } from "@/lib/images/transform";

/**
 * POST /api/r2/upload — the normal upload path.
 *
 * It used to be the CORS fallback behind a presigned direct-to-R2 PUT, because
 * a 3.8 MB camera photo does not fit through a Vercel Node function (4.5 MB
 * body limit). The browser downscales to ~250 KB before posting
 * (lib/images/downscale.ts), which both removes that constraint and makes the
 * upload itself ~10x faster on mobile upstream.
 *
 * Since ADR-0008 this route does no image processing: it stores the posted
 * bytes as one object and resizing happens on read, in Vercel's optimizer. So
 * it differs from `/api/r2/presigned-url` — still the fallback for a browser
 * that cannot downscale — only in going through the function rather than
 * straight to the bucket.
 *
 * Returns the stored key. That is what callers persist, and `POST
 * /api/admin/images` and the collections PATCH both derive the stored url from
 * it rather than trusting a client-supplied one.
 */
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const folder = (formData.get("folder") as string) || "uploads";

    if (!file) {
      return NextResponse.json(
        { error: "No file provided in request" },
        { status: 400 }
      );
    }

    if (!ACCEPTED_UPLOAD_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: `File type '${file.type}' is not allowed.` },
        { status: 400 }
      );
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error:
            "Image is too large to process here. It should have been resized in " +
            "the browser first — reload the page and try again.",
        },
        { status: 413 }
      );
    }

    const source = Buffer.from(await file.arrayBuffer());
    const { key, url } = await writeImage(source, {
      folder,
      filename: file.name,
      contentType: file.type,
    });

    return NextResponse.json({ success: true, key, publicUrl: url });
  } catch (error: any) {
    console.error("Server upload error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server upload error" },
      { status: 500 }
    );
  }
}
