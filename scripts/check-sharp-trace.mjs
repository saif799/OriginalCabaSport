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
 * It also fails if a traced path runs through a symlinked directory. Vercel
 * rejects such a function outright — "The framework produced an invalid
 * deployment package for a Serverless Function" — and it does so at deploy
 * time, after a green build, which is a slow and confusing way to find out.
 * pnpm's default isolated layout puts the only RPATH-satisfying copy of
 * libvips behind exactly such a symlink; pnpm-workspace.yaml pins a hoisted
 * layout to avoid it, and this is the check that notices if that comes undone.
 *
 * ## Why it is meaningful on Windows
 *
 * It cannot see the linux files from a Windows build — they are not installed.
 * What it does check is that `outputFileTracingIncludes` still reaches a native
 * library at all, via the win32 entry in SHARP_NATIVE_LIBS, and that no traced
 * path runs through a symlink. The second half is platform-independent: it is
 * the node_modules layout that is being judged, not the binaries, so a Windows
 * run catches a layout regression that would fail the linux deploy.
 */
import { readFileSync, existsSync, lstatSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";

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

  // Any symlink between the function root and a traced file makes the whole
  // deployment package invalid, regardless of what the file is.
  const base = resolve(`.next/server/app/${route}`);
  const symlinked = [];
  for (const rel of files) {
    let p = base;
    for (const seg of rel.split("/")) {
      p = resolve(p, seg);
      try {
        if (lstatSync(p).isSymbolicLink()) { symlinked.push(`${p.split(sep).slice(-4).join("/")} (from ${rel})`); break; }
      } catch { break; }
    }
  }
  if (symlinked.length) {
    console.error(
      `FAIL     ${route} — ${symlinked.length} traced path(s) run through a symlink`
    );
    for (const x of symlinked.slice(0, 3)) console.error(`           ${x}`);
    console.error(
      `           Vercel will reject this function as an invalid deployment package`
    );
    failed = true;
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
