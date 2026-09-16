import { requireAdmin } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { getPresignedUploadUrl } from "@/lib/r2";

import { ACCEPTED_UPLOAD_TYPES } from "@/lib/images/source";

/**
 * The fallback path, not the normal one.
 *
 * Uploads go through POST /api/r2/upload. This route only runs when the browser
 * could not downscale the file and the original is too big to post, so it PUTs
 * direct to the bucket and skips the 4.5 MB function body limit.
 *
 * Since ADR-0008 both paths store the same thing — one object under one key,
 * resized on read — so this differs only in transport, not in what lands in R2.
 */

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const body = await request.json();
    const { filename, contentType, folder } = body;

    if (!filename || typeof filename !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'filename'" },
        { status: 400 }
      );
    }

    if (!contentType || typeof contentType !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'contentType'" },
        { status: 400 }
      );
    }

    if (!ACCEPTED_UPLOAD_TYPES.has(contentType)) {
      return NextResponse.json(
        { error: `File type '${contentType}' is not allowed. Only images are permitted.` },
        { status: 400 }
      );
    }

    const presignedData = await getPresignedUploadUrl({
      filename,
      contentType,
      folder: typeof folder === "string" ? folder : "uploads",
    });

    return NextResponse.json(presignedData);
  } catch (error: any) {
    console.error("Failed to generate R2 presigned URL:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
