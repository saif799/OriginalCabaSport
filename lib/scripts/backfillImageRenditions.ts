/**
 * One-off migration for ADR-0007: turn the oversized images already in R2 into
 * the three webp Renditions every new upload now produces.
 *
 * At the time of writing, 48 of the 375 `shoe_images` rows are camera JPEGs
 * averaging 1.35 MB (max 3.8 MB) — 65 MB that customers were downloading in
 * full. The other ~327 rows were hand-optimised to 30-50 KB before upload and
 * are deliberately left alone: re-encoding them costs a generation of quality
 * and saves nothing. `lib/images/loader.ts` serves those untouched.
 *
 * Selection is by size, not by a hardcoded list, so re-running it later picks up
 * anything that slipped through the presigned fallback.
 *
 * Two phases, because deleting the original is the one step nothing can undo —
 * those files exist nowhere else:
 *
 *   npx tsx lib/scripts/backfillImageRenditions.ts                    # dry run, prints the plan
 *   npx tsx lib/scripts/backfillImageRenditions.ts --apply            # writes renditions, repoints rows
 *   # ...browse the storefront and admin, confirm nothing 404s...
 *   npx tsx lib/scripts/backfillImageRenditions.ts --purge            # dry run, lists what would go
 *   npx tsx lib/scripts/backfillImageRenditions.ts --purge --apply    # deletes the originals
 *
 * `--apply` means "actually write" in both phases, so every destructive step
 * has a dry run in front of it.
 *
 * `--apply` records every original key in .image-backfill-manifest.json (git
 * ignored). `--purge` reads that file and nothing else: it will not guess.
 *
 * Safe to re-run. A row already pointing at a Rendition is skipped.
 */

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

import { shoeImages, storefrontCollections } from "../schema";
import { deleteR2Object, getR2Object, getR2ObjectSize } from "../r2";
import { isRenditionRef } from "../images/renditions";
import { ALREADY_SMALL_BYTES, isAlreadySmall } from "../images/source";
import { writeRenditions } from "../images/transform";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const PURGE = process.argv.includes("--purge");

const MANIFEST = path.join(process.cwd(), ".image-backfill-manifest.json");

/** The `<uuid>-` every existing key already carries in front of the filename. */
const EXISTING_KEY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;

type Target = {
  table: "shoe_images" | "storefront_collections";
  id: string;
  key: string;
  bytes: number;
};

const kb = (n: number) => `${Math.round(n / 1024)}KB`;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const db = drizzle(neon(process.env.DATABASE_URL));

  if (PURGE) return purge();

  const images = await db
    .select({ id: shoeImages.id, key: shoeImages.cloudflareImageId })
    .from(shoeImages);
  const collections = await db
    .select({ id: storefrontCollections.id, key: storefrontCollections.imageKey })
    .from(storefrontCollections);

  const candidates: { table: Target["table"]; id: string; key: string }[] = [
    ...images.map((r) => ({ table: "shoe_images" as const, id: String(r.id), key: r.key })),
    ...collections
      .filter((r): r is typeof r & { key: string } => Boolean(r.key))
      .map((r) => ({ table: "storefront_collections" as const, id: String(r.id), key: r.key })),
  ].filter((r) => r.key && !isRenditionRef(r.key));

  console.log(
    `${images.length} gallery rows, ${collections.length} collections; ` +
      `${candidates.length} not yet renditioned. Measuring...`,
  );

  const targets: Target[] = [];
  for (const c of candidates) {
    try {
      const bytes = await getR2ObjectSize(c.key);
      // The same line the upload path passes an image through on: a row this
      // run leaves alone is one a re-upload would leave alone too. Only images
      // above it are worth re-encoding — the hand-optimised rows sit at
      // 30-50 KB, the camera JPEGs start around 500 KB.
      if (!isAlreadySmall(bytes)) targets.push({ ...c, bytes });
    } catch (error) {
      // Loud on purpose: a silently unmeasured image is one that quietly does
      // not get backfilled, and nothing downstream would ever notice.
      console.warn(`  ! could not measure ${c.key}:`, error);
    }
  }

  targets.sort((a, b) => b.bytes - a.bytes);
  const total = targets.reduce((sum, t) => sum + t.bytes, 0);
  console.log(
    `\n${targets.length} images over ${kb(ALREADY_SMALL_BYTES)}, ${(total / 1048576).toFixed(1)}MB in total:\n`,
  );
  for (const t of targets) console.log(`  ${kb(t.bytes).padStart(8)}  ${t.key}`);

  if (!APPLY) {
    console.log(
      `\nDry run. Nothing written. Re-run with --apply to create renditions and repoint rows.`,
    );
    return;
  }

  const done: Target[] = [];
  let written = 0;

  for (const t of targets) {
    try {
      const source = await getR2Object(t.key);
      const { key, url, keys } = await writeRenditions(source, {
        folder: path.posix.dirname(t.key),
        // Strip the existing key's uuid: `writeRenditions` prepends a fresh
        // one, and without this the backfilled keys read `<uuid>-<uuid>-IMG_x`
        // and stop matching the shape lib/images/renditions.ts documents.
        filename: path.posix.basename(t.key).replace(EXISTING_KEY_UUID, ""),
      });

      if (t.table === "shoe_images") {
        await db
          .update(shoeImages)
          .set({ cloudflareImageId: key, url })
          .where(eq(shoeImages.id, t.id));
      } else {
        await db
          .update(storefrontCollections)
          .set({ imageKey: key, imageUrl: url })
          .where(eq(storefrontCollections.id, t.id));
      }

      done.push(t);
      written += keys.length;
      console.log(`  ok  ${kb(t.bytes).padStart(8)} -> ${key}`);
    } catch (error) {
      // Left for the next run: the row still points at its original, so the
      // image keeps working. A partial rendition set is orphaned in R2, which
      // costs storage and nothing else.
      console.error(`  FAIL ${t.key}:`, error);
    }
  }

  fs.writeFileSync(MANIFEST, JSON.stringify({ at: new Date().toISOString(), done }, null, 2));

  console.log(
    `\n${done.length}/${targets.length} images backfilled, ${written} rendition objects written.` +
      `\nOriginals are still in R2. Check the storefront and /admin, then run --purge to delete them.` +
      `\nManifest: ${MANIFEST}`,
  );
}

async function purge() {
  if (!fs.existsSync(MANIFEST)) {
    console.error(`No manifest at ${MANIFEST}. Run --apply first; --purge never guesses.`);
    process.exitCode = 1;
    return;
  }

  const { done } = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as { done: Target[] };
  console.log(`Manifest lists ${done.length} originals to delete.\n`);

  if (!APPLY) {
    for (const t of done) console.log(`  would delete  ${kb(t.bytes).padStart(8)}  ${t.key}`);
    console.log(`\nDry run. Re-run with --purge --apply to delete them.`);
    return;
  }

  let deleted = 0;
  for (const t of done) {
    try {
      await deleteR2Object(t.key);
      deleted++;
      console.log(`  deleted  ${t.key}`);
    } catch (error) {
      console.error(`  FAIL ${t.key}:`, error);
    }
  }

  if (deleted === done.length) fs.rmSync(MANIFEST);
  console.log(`\n${deleted}/${done.length} originals deleted.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
