import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerUploadError, uploadImageFile } from "@/lib/images/upload";

/**
 * What may reach the presigned fallback.
 *
 * The fallback PUTs straight to the bucket, which needs a CORS rule that the
 * same-origin POST to /api/r2/upload does not. When it caught *every* server
 * failure, a broken route came back to the user as
 * "Network/CORS error during direct upload" — the fallback's own error, about
 * a request that only happened because the real one had already failed. The
 * route's 500 said which library had failed to load; nobody ever saw it.
 *
 * So the rule under test is about which failures are the fallback's business:
 * a verdict on the file's *size* is, and nothing else is.
 *
 * Node has no XMLHttpRequest and no createImageBitmap, so the browser
 * downscale short-circuits to the original file and the transport is a stub
 * that records whether the presign endpoint was reached at all.
 */

interface StubbedXhr {
  status: number;
  responseText: string;
}

function stubTransport({ status, responseText }: StubbedXhr) {
  const presignCalls: string[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      presignCalls.push(url);
      return {
        ok: true,
        json: async () => ({
          uploadUrl: "https://bucket.example/put",
          key: "k",
          publicUrl: "https://cdn.example/k",
        }),
      } as unknown as Response;
    }),
  );

  class FakeXhr {
    status = 0;
    responseText = "";
    upload: { onprogress: ((e: unknown) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private isServerPost = false;

    open(_method: string, url: string) {
      this.isServerPost = url === "/api/r2/upload";
    }
    setRequestHeader() {}
    send() {
      // The server POST fails with the status under test; the direct PUT that
      // the fallback would make succeeds, so a fallback is visible as a pass
      // rather than as a second error.
      this.status = this.isServerPost ? status : 200;
      this.responseText = this.isServerPost ? responseText : "";
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeXhr);

  return presignCalls;
}

const png = () => new File([new Uint8Array([1, 2, 3])], "shoe.png", { type: "image/png" });

afterEach(() => vi.unstubAllGlobals());

describe("uploadImageFile fallback policy", () => {
  it("surfaces a 500 from the route instead of retrying it as a direct PUT", async () => {
    const presignCalls = stubTransport({
      status: 500,
      responseText: JSON.stringify({ error: "sharp failed to load on this host" }),
    });

    await expect(uploadImageFile(png(), { folder: "f" })).rejects.toThrow(
      /sharp failed to load on this host/,
    );
    expect(presignCalls).toEqual([]);
  });

  it("tags the rejection with the status so callers can branch on it", async () => {
    stubTransport({ status: 500, responseText: "<!doctype html>a platform error page" });

    const err = await uploadImageFile(png(), { folder: "f" }).catch((e) => e);
    expect(err).toBeInstanceOf(ServerUploadError);
    expect((err as ServerUploadError).status).toBe(500);
  });

  it("still falls back when the route says the bytes are too big for it", async () => {
    const presignCalls = stubTransport({
      status: 413,
      responseText: JSON.stringify({ error: "Image is too large to process here." }),
    });

    await expect(uploadImageFile(png(), { folder: "f" })).resolves.toEqual({
      key: "k",
      url: "https://cdn.example/k",
    });
    expect(presignCalls).toEqual(["/api/r2/presigned-url"]);
  });
});
