import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { buildSingleObjectKey } from "@/lib/images/renditions";

export function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("Cloudflare R2 credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) are missing in environment variables.");
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

/**
 * Base URL that serves R2 objects publicly over plain HTTP GET.
 *
 * This is deliberately NOT the S3 API endpoint (`<accountId>.r2.cloudflarestorage.com`):
 * that endpoint only answers authenticated, SigV4-signed S3 requests, so a browser
 * `<img src>` pointed at it always renders a broken image. The S3 endpoint stays
 * confined to `getR2Client()` (upload / delete / presign).
 *
 * Configure with a custom domain bound to the bucket (preferred — `r2.dev` is
 * rate-limited and documented by Cloudflare as development-only):
 *   R2_PUBLIC_URL=https://cdn.example.com
 * or, as a stopgap, the bucket's public dev URL:
 *   R2_PUBLIC_URL=https://pub-<hash>.r2.dev
 *
 * Swapping r2.dev for a custom domain later is a one-line change to this env var
 * plus a re-run of `npx tsx lib/scripts/fixR2ImageUrls.ts` to rewrite stored rows.
 */
export function getR2PublicBaseUrl(): string {
  const raw = process.env.R2_PUBLIC_URL ?? process.env.NEXT_PUBLIC_R2_PUBLIC_URL;

  if (!raw || !raw.trim()) {
    throw new Error(
      "R2_PUBLIC_URL is not configured. Set it to the bucket's public base URL " +
        "(a custom domain, or https://pub-<hash>.r2.dev) — not the S3 API endpoint."
    );
  }

  const base = raw.trim().replace(/\/+$/, "");

  if (base.includes("<") || base.includes(">")) {
    throw new Error(
      `R2_PUBLIC_URL still contains a placeholder ("${base}"). Replace it with the ` +
        "real public base URL from the Cloudflare dashboard (R2 > your bucket > Settings > Public access)."
    );
  }

  let hostname: string;
  try {
    hostname = new URL(base).hostname;
  } catch {
    throw new Error(`R2_PUBLIC_URL is not a valid absolute URL: "${base}"`);
  }

  if (hostname.endsWith(".r2.cloudflarestorage.com")) {
    throw new Error(
      `R2_PUBLIC_URL points at the S3 API endpoint ("${base}"). That endpoint only ` +
        "serves authenticated S3 requests and cannot be used as an <img> src. Use the " +
        "bucket's public custom domain or its https://pub-<hash>.r2.dev URL instead."
    );
  }

  return base;
}

/** Builds the browser-facing URL for an R2 object key. */
export function buildR2PublicUrl(key: string): string {
  const cleanKey = key.replace(/^\/+/, "");
  const encoded = cleanKey.split("/").map(encodeURIComponent).join("/");
  return `${getR2PublicBaseUrl()}/${encoded}`;
}

export interface PresignedUrlParams {
  filename: string;
  contentType: string;
  folder?: string;
  expiresInSeconds?: number;
}

export interface PresignedUrlResponse {
  uploadUrl: string;
  key: string;
  publicUrl: string;
}

export async function getPresignedUploadUrl({
  filename,
  contentType,
  folder = "uploads",
  expiresInSeconds = 900, // 15 minutes
}: PresignedUrlParams): Promise<PresignedUrlResponse> {
  const bucketName = process.env.R2_BUCKET_NAME;

  if (!bucketName) {
    throw new Error("R2_BUCKET_NAME is not configured in environment variables");
  }

  const client = getR2Client();

  // Shared with the rendition path so the two cannot drift, and so a file named
  // "photo_800.webp" cannot be stored under a key the image loader would mistake
  // for a rendition and rewrite into objects that were never written.
  const key = buildSingleObjectKey(folder, filename);

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: expiresInSeconds,
  });

  // Built from the public base URL only. Never derived from `uploadUrl`: stripping
  // the query off a presigned URL yields the S3 API endpoint, which browsers cannot GET.
  const publicUrl = buildR2PublicUrl(key);

  return {
    uploadUrl,
    key,
    publicUrl,
  };
}

/**
 * Physically deletes an object from the Cloudflare R2 bucket.
 * Requires the API key to have DeleteObject permission.
 */
export async function deleteR2Object(key: string): Promise<void> {
  const bucketName = process.env.R2_BUCKET_NAME;
  if (!bucketName) {
    throw new Error("R2_BUCKET_NAME is not configured in environment variables");
  }
  const client = getR2Client();
  await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
}

/**
 * Reads an object's size, and its bytes, back out of the bucket.
 *
 * Used by the ADR-0007 backfill, which measures a few hundred objects and then
 * pulls the oversized ones. Deliberately the authenticated S3 endpoint rather
 * than the public URL: pub-<hash>.r2.dev is rate-limited, and a throttled HEAD
 * there answers with no content-length rather than an error — so an image would
 * silently measure as 0 bytes and drop out of the backfill entirely.
 */
export async function getR2ObjectSize(key: string): Promise<number> {
  const bucketName = process.env.R2_BUCKET_NAME;
  if (!bucketName) {
    throw new Error("R2_BUCKET_NAME is not configured in environment variables");
  }
  const client = getR2Client();
  const res = await client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
  return res.ContentLength ?? 0;
}

export async function getR2Object(key: string): Promise<Buffer> {
  const bucketName = process.env.R2_BUCKET_NAME;
  if (!bucketName) {
    throw new Error("R2_BUCKET_NAME is not configured in environment variables");
  }
  const client = getR2Client();
  const res = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
  if (!res.Body) throw new Error(`R2 object "${key}" has no body`);
  return Buffer.from(await res.Body.transformToByteArray());
}
