import { requireAdmin } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { ACCEPTED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "@/lib/images/source";
import { writeRenditions } from "@/lib/images/transform";

/**
 * POST /api/r2/upload — the normal upload path since ADR-0007.
 *
 * It used to be the CORS fallback behind a presigned direct-to-R2 PUT, because
 * a 3.8 MB camera photo does not fit through a Vercel Node function (4.5 MB
 * body limit). The browser now downscales to ~250 KB before posting
 * (lib/images/downscale.ts), which both removes that constraint and makes the
 * upload itself ~10x faster on mobile upstream — so the bytes come here, sharp
 * writes three Renditions, and the file that was posted is never stored.
 *
 * `/api/r2/presigned-url` survives as the fallback for a browser that cannot
 * downscale; what it stores is a legacy single file with no Renditions, which
 * the image loader serves untouched.
 *
 * Returns the DEFAULT_RENDITION_WIDTH key. That is what callers persist, and it
 * is a real object — `POST /api/admin/images` and the collections PATCH both
 * derive the stored url from it.
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
    const { key, url } = await writeRenditions(source, {
      folder,
      filename: file.name,
    });

    // Only the DEFAULT_RENDITION_WIDTH key. The other two are derived from it by
    // convention, so returning them would invite a caller to store them.
    return NextResponse.json({ success: true, key, publicUrl: url });
  } catch (error: any) {
    console.error("Server upload error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server upload error" },
      { status: 500 }
    );
  }
}
