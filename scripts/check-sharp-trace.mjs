/**
 * Asserts that sharp's native shared libraries reach the deployed function bundle.
 *
 * Run after `pnpm build`:
 *
 *     node scripts/check-sharp-trace.mjs
 *
 * ## What it is guarding
 *
 * sharp's addon (`@img/sharp-<platform>/lib/*.node`) is only the binding. On
 * linux libvips itself lives in a *separate* package,
 * `@img/sharp-libvips-linux-x64`, and the addon reaches it at load time through
 * an ELF RPATH rather than a `require`. Output file tracing follows the module
 * graph, so it copies the addon and leaves libvips behind — and the function
 * then dies on first use with
 *
 *     ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.6: cannot open shared object file
 *
 * `outputFileTracingIncludes` in next.config.mjs is what puts it back. This
 * script reads the trace manifests Vercel uses to build each function and fails
 * if a route traces an addon without a libvips library beside it.
 *
 * ## Why it is meaningful on Windows
 *
 * It cannot see the linux files from a Windows build — they are not installed.
 * What it does check is the two mechanisms the linux globs depend on: that
 * `outputFileTracingIncludes` pulls in a native library at all, and that its
 * glob is followed through a pnpm store symlink. Both are exercised by the
 * win32 entry in SHARP_NATIVE_LIBS, whose libvips DLLs sit behind a symlink at
 * `.pnpm/sharp@<version>/node_modules/@img/`. If those stop arriving, the linux globs
 * have stopped working too and production is about to 500.
 */
import { readFileSync, existsSync } from "node:fs";

/** Routes that import lib/images/transform.ts, and so reach sharp. */
const ROUTES = [
  "api/r2/upload",
  "api/admin/images",
  "api/admin/collections/[collectionId]",
];

const ADDON = /@img[\\/]sharp-[a-z0-9-]+[\\/].*\.node$/;
const LIBVIPS = /libvips[^\\/]*\.(so(\.[\d.]+)?|dll|dylib)$/;

let failed = false;
let checked = 0;

for (const route of ROUTES) {
  const manifest = `.next/server/app/${route}/route.js.nft.json`;
  if (!existsSync(manifest)) {
    console.error(`MISSING  ${route} — no trace manifest; run \`pnpm build\` first`);
    failed = true;
    continue;
  }

  const files = JSON.parse(readFileSync(manifest, "utf8")).files;
  const addons = files.filter((f) => ADDON.test(f));
  const libs = files.filter((f) => LIBVIPS.test(f));

  if (!addons.length) {
    // Nothing to judge: no sharp addon was traced for this route at all.
    console.error(`SKIP     ${route} — no sharp addon traced`);
    continue;
  }

  checked++;
  if (!libs.length) {
    console.error(
      `FAIL     ${route} — addon traced, no libvips library beside it\n` +
        `           addon: ${addons[0]}\n` +
        `           this is the production ERR_DLOPEN_FAILED, pre-deploy`
    );
    failed = true;
  } else {
    console.log(`ok       ${route} — ${addons.length} addon, ${libs.length} libvips`);
    for (const l of libs) console.log(`           ${l}`);
  }
}

if (!checked && !failed) {
  console.error("INCONCLUSIVE — no route traced a sharp addon; nothing was verified");
  process.exit(2);
}

process.exit(failed ? 1 : 0);
