import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { writeRenditions } from "@/lib/images/transform";
import { ALREADY_SMALL_BYTES } from "@/lib/images/source";

/**
 * `writeRenditions` against real sharp, with R2 stubbed out.
 *
 * The assertion that matters is byte identity: an already-small webp must come
 * back out of the pipeline as the exact bytes that went in at every width that
 * would not resize it. Anything else is a lossy generation spent for nothing.
 */

const puts: { Key: string; Body: Buffer; ContentType: string }[] = [];

vi.mock("@/lib/r2", () => ({
  getR2Client: () => ({
    send: async (command: any) => {
      puts.push(command.input);
    },
  }),
  buildR2PublicUrl: (key: string) => `https://cdn.test/${key}`,
  deleteR2Object: async () => {},
}));

/** A flat-colour raster compresses to a few hundred bytes — always "already small". */
function solid(width: number, height: number) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } },
  });
}

/** Flat colour and hard edges: a logo, near enough — what lossless is for. */
function graphic(width: number, height: number) {
  const block = (w: number, h: number, r: number, g: number, b: number) => ({
    create: { width: Math.round(w), height: Math.round(h), channels: 3 as const, background: { r, g, b } },
  });
  return sharp(block(width, height, 245, 245, 240)).composite([
    { input: block(width / 2, height / 2, 20, 20, 30), top: 20, left: 20 },
    { input: block(width / 3, height / 6, 220, 40, 40), top: Math.round(height / 2), left: 30 },
  ]);
}

/** Noise, so nothing under test can pass by compressing a flat field to nothing. */
function noisy(width: number, height: number) {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (Math.random() * 256) | 0;
  return sharp(raw, { raw: { width, height, channels: 3 } });
}

function bodyFor(key: string) {
  return puts.find((p) => p.Key.endsWith(key))!.Body;
}

const bucketBefore = process.env.R2_BUCKET_NAME;

beforeEach(() => {
  process.env.R2_BUCKET_NAME = "test-bucket";
  puts.length = 0;
});

afterEach(() => {
  process.env.R2_BUCKET_NAME = bucketBefore;
});

describe("writeRenditions", () => {
  it("stores an already-small webp verbatim where it would not be resized", async () => {
    const source = await solid(600, 600).webp({ quality: 90 }).toBuffer();

    await writeRenditions(source, { folder: "products", filename: "hand-optimised.webp" });

    expect(puts).toHaveLength(3);
    expect(bodyFor("_800.webp").equals(source)).toBe(true);
    expect(bodyFor("_1600.webp").equals(source)).toBe(true);
    // 400 is a genuine downsize, so it is encoded — and is smaller for it.
    expect(bodyFor("_400.webp").equals(source)).toBe(false);
    expect(bodyFor("_400.webp").length).toBeLessThan(source.length);
  });

  it("re-encodes a source that is not already webp", async () => {
    const source = await solid(600, 600).png().toBuffer();

    await writeRenditions(source, { folder: "products", filename: "logo.png" });

    for (const put of puts) {
      expect(put.ContentType).toBe("image/webp");
      expect(put.Body.equals(source)).toBe(false);
      expect(put.Body.subarray(8, 12).toString()).toBe("WEBP");
    }
  });

  it("encodes an already-small png losslessly, pixel for pixel", async () => {
    // A png is the one lossless source we accept — a logo or a brand image,
    // where q70 artefacts are exactly what gets looked at.
    const source = await graphic(600, 600).png().toBuffer();
    expect(source.length).toBeLessThan(ALREADY_SMALL_BYTES);

    await writeRenditions(source, { folder: "products", filename: "logo.png" });

    // `ensureAlpha` only so the two rasters are comparable: a webp decodes to
    // four channels, the source png to three.
    const pixels = async (buffer: Buffer) =>
      sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const before = await pixels(source);
    const after = await pixels(bodyFor("_800.webp"));
    expect(after.info.width).toBe(before.info.width);
    expect(after.data.equals(before.data)).toBe(true);
  });

  it("still compresses a png that is not already small", async () => {
    const source = await noisy(1200, 1200).png().toBuffer();
    expect(source.length).toBeGreaterThan(ALREADY_SMALL_BYTES);

    await writeRenditions(source, { folder: "products", filename: "photo.png" });

    expect(bodyFor("_1600.webp").length).toBeLessThan(source.length);
  });

  it("re-encodes an unresized webp when the encode saves more than the budget", async () => {
    // Nothing here is resized at 1600 — the encode is kept for its bytes alone.
    // Noise does not compress, so this is a source worth re-compressing.
    const source = await noisy(1400, 1400).webp({ quality: 95 }).toBuffer();
    expect(source.length).toBeGreaterThan(ALREADY_SMALL_BYTES);

    await writeRenditions(source, { folder: "products", filename: "IMG_0606.webp" });

    expect(bodyFor("_1600.webp").equals(source)).toBe(false);
  });

  it("re-encodes an already-small webp that still has an orientation to bake in", async () => {
    // Reusing the source bytes would also skip `.rotate()`, storing a photo
    // that only ever looked upright because of its EXIF tag on its side.
    const source = await solid(900, 300)
      .withMetadata({ orientation: 6 })
      .webp()
      .toBuffer();

    await writeRenditions(source, { folder: "products", filename: "IMG_1.webp" });

    for (const put of puts) expect(put.Body.equals(source)).toBe(false);
    const stored = await sharp(bodyFor("_1600.webp")).metadata();
    expect([stored.width, stored.height]).toEqual([300, 900]);
  });

  it("returns the 800 rendition as the stored key", async () => {
    const source = await solid(300, 300).webp().toBuffer();

    const written = await writeRenditions(source, { folder: "products", filename: "a.webp" });

    expect(written.key).toBe(`${written.base}_800.webp`);
    expect(written.url).toBe(`https://cdn.test/${written.key}`);
    expect(written.keys).toEqual([400, 800, 1600].map((w) => `${written.base}_${w}.webp`));
  });
});
