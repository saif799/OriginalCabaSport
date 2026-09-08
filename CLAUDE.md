# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

when reporting information to me be extremly concise and sacrafice grammar for the sake of concision.

## Commands

Package manager is **pnpm** (`pnpm-lock.yaml`, `pnpm-workspace.yaml`).

```bash
pnpm dev                 # next dev
pnpm build               # next build
pnpm start               # next start
npx tsc --noEmit         # the only real typecheck (see gotcha below)

pnpm push                # drizzle-kit push — THE schema workflow used here
pnpm studio              # drizzle-kit studio
pnpm generate            # drizzle-kit generate (rarely used; drizzle/ is stale)
pnpm migrate             # drizzle-kit migrate

npx tsx lib/seed/seedDeliveryData.ts   # one-shot seed of delivery coverage tables from the legacy root JSONs
npx tsx lib/scripts/fixR2ImageUrls.ts   # dry-run rewrite of shoe_images.url onto R2_PUBLIC_URL (--apply to write)
npx tsx lib/scripts/backfillImageRenditions.ts  # dry-run; --apply writes renditions, then --purge --apply deletes originals
```

Tests are Vitest (`pnpm test` -> `vitest run`), living in `tests/` against a PGlite test DB ([tests/testDb.ts](tests/testDb.ts)). Coverage is partial: `placeOrder`, `lib/stock/movement`, storefront products, and a smoke test.

**Gotcha:** `next.config.mjs` sets `typescript.ignoreBuildErrors` — a green `pnpm build` proves nothing about types. Run `npx tsc --noEmit` after changes.

**Gotcha:** `drizzle/` contains a single migration from an early commit and is not maintained. Schema changes are applied with `pnpm push` against the Neon database — after editing [lib/schema.ts](lib/schema.ts), push, don't generate a migration.

## Architecture

Next.js 16 App Router + React 19, Tailwind v4, shadcn/ui (new-york, `components/ui/`), Drizzle ORM on Neon Postgres, deployed on Vercel. `vercel.json` registers a daily cron on `/api/status` (delivery status sync).

### Two apps in one Next project

Decided in [docs/adr/0001-storefront-routing-and-pricing-model.md](docs/adr/0001-storefront-routing-and-pricing-model.md):

- **`app/(storefront)/`** — public customer store at `/`. Catalog, product page, Collection page, checkout, order confirmation. Checkout is restricted to the DHD provider and creates orders with the ready-to-ship `statusId` (whose row is named `prete a expedier` — with spaces; the underscored form is a courier `external_statuses` value, not the internal name). Storefront-only helpers live in `lib/storefront/` and `components/storefront/`.
- **`app/admin/(admin)/`** — internal inventory dashboard under `/admin/*` (products, add-shoes, arrivals, orders, analytics, gallery, borrowers, rebalance, settings, `borrowers/[lenderId]` borrower detail). The route list lives in [components/admin/AdminSidebar.tsx](components/admin/AdminSidebar.tsx), and every page renders through the shared shell in [components/admin/AdminPage.tsx](components/admin/AdminPage.tsx).
- **`app/api/`** — REST routes used by client components of both apps. Admin-only mutations (product/model edits, image management, the Collections CMS) are namespaced under `app/api/admin/`; everything else is shared.
- [proxy.ts](proxy.ts) (Next 16's renamed `middleware.ts`) does two jobs: it gates the admin surface, then routes storefront locales. It tags storefront requests with the locale header the root layout reads for `lang`/`dir`; `/admin` is left untagged and stays `lang="en"` LTR.

### Auth

`/admin/*` and every `/api/*` route **except an explicit allowlist** require the single admin password ([ADR-0005](docs/adr/0005-admin-auth-is-a-single-password-signed-cookie.md)). There is one user — the owner — and no user table.

- [lib/auth/session.ts](lib/auth/session.ts) — HMAC-signed stateless cookie. Edge-safe (Web Crypto only, no Node built-ins) because `proxy.ts` imports it.
- [lib/auth/protected.ts](lib/auth/protected.ts) — **the** allowlist, and it defaults closed: a new `/api` route is protected the moment it exists. Membership is per path *and method* — `/api/order` is public for `POST` (storefront checkout) and admin-only for `GET`/`DELETE`.
- [lib/auth/guard.ts](lib/auth/guard.ts) — `requireAdmin()` for route handlers, `requireAdminPage()` for Server Components. The proxy already blankets these paths; the guards are the layer that still holds if it is bypassed. Both are in use — don't remove one as "redundant".
- `GET /api/status` is the one route with two credentials (cron bearer *or* session), because the Vercel cron and the admin sync button both call it.
- Requires `ADMIN_PASSWORD`, `AUTH_SECRET`, and `CRON_SECRET` — see `.env.example`.

**Gotcha:** the `matcher` in `proxy.ts` is load-bearing for security. It used to exclude `admin|api`; narrowing it again kills the gate silently. [tests/auth/proxyGate.test.ts](tests/auth/proxyGate.test.ts) replays the real regex to catch that.

Server components read `db` directly; client components `fetch` the `/api/*` routes. Writes call `revalidatePath`.

### Database access: two drivers on purpose

[lib/db.ts](lib/db.ts) exports both because neon-http has no transaction support:

- `db` — neon-http, default for all reads and non-atomic writes.
- `txClient()` — lazily-created WebSocket `Pool` client, the only way to get `.transaction()`.
- `Executor = typeof db | Tx` — helpers that must work both standalone and inside a caller's transaction take an `exec: Executor = db` parameter (see `flagNotifier`). The two drivers have slightly different static types, so such helpers narrow with `exec as typeof db`.

Any write that touches stock **and** another table (order rows, lend rows, notifier flags) must run inside `txClient().transaction()`.

### Data model ([lib/schema.ts](lib/schema.ts))

`shoeModels` (a style, e.g. "Air Force 1", carries `basePrice`/`compareAtPrice`) → `shoes` (a **color variant**, `varchar` PK that doubles as the printed barcode value, carries optional `priceOverride`/`compareAtPriceOverride`) → `shoeInventory` (one row per **size**, holds `quantity` and optional `priceOverride`). `shoeInventory.id` is the unit of stock everything else points at. Pricing lives on the model since [ADR-0002](docs/adr/0002-model-level-pricing.md); see Pricing & money below.

- **`ordersTable`** — PK is the **delivery provider's tracking number**, not a generated id. `provider` says which company shipped it; `statusId` FKs `status_groups_table` (note the misspelled export `stautsGroupsTable`); `borrowerId` is set when a borrower placed the sale from their own held stock.
- **`status_groups_table`** — maps our internal status names to arrays of `external_statuses` strings returned by providers. Status ids are resolved from names (and back) through [lib/orders/status.ts](lib/orders/status.ts), the single place they're defined; `ordersTable.statusId` still carries a hardcoded default. The legacy `ordersTable.status` varchar column that used to duplicate `statusId` has been dropped (issue #9).
- **`borrower` / `LendedShoes`** — an append-only signed ledger, not a balance. Lending inserts `+n`, returning inserts a row, and a borrower-placed order inserts `-1`. Holdings are always `SUM(quantity)`. Owner↔borrower rebalancing is computed live in `GET /api/rebalance` — there is no stored table.
- **`arrivals` / `arrivalItems`** — an "arrivage" (received shipment). `arrivalItems.quantity` is an immutable snapshot of what arrived, deliberately not kept in sync with live `shoeInventory.quantity`.
- **`shoeImages`** — R2 gallery per color variant; `isPrimary` is the catalog thumbnail, `sortOrder` the carousel order.
- **`storefrontCollections` / `storefrontCollectionItems`** — the Collections CMS ([ADR-0006](docs/adr/0006-collections-replace-homepage-rails.md)): a hand-picked, ordered set of colour variants with an image, a `slug` and a page at `/[lng]/collection/<slug>`. The homepage is the grid of them and shows no products of its own. Read them through [lib/storefront/collections.ts](lib/storefront/collections.ts) — `getVisibleCollections()` for the grid, `getCollectionBySlug()` for the page. `imageUrl` is always derived server-side from `imageKey` (the R2 object key), the same rule as `shoeImages`. Three separate not-showing states, deliberately not one flag: *Incomplete* (no image) never renders, *Hidden* (`isVisible = false`) 404s its route, *Empty* (no live pick) drops off the grid but keeps serving its URL.
- **`ImageNotifierTable`** — a work queue for "add/remove this variant's photo from the Instagram gallery", consumed by `/admin/gallery` (the route was called `/admin/notifier` until issue #15; the API is still `/api/notifier/*`).
- **Delivery coverage tables** (`dhd_wilayas`, `dhd_communes`, `dhd_tarifs`, `yalidine_wilayas`, `yalidine_communes`) — the DB replacement for the root-level `communes.json`, `tarifs.json`, `yalidinCommunes_withExpressDesk.json`. Read them through [lib/delivery/coverageData.ts](lib/delivery/coverageData.ts), never re-import the JSONs. (`wilayas.json` is still imported for wilaya display names in analytics and the orders table.)

### Stock invariants

[lib/stock/movement.ts](lib/stock/movement.ts) exports `applyMovement`, the single entry point for every Stock Movement — no route, server action, or script writes `shoeInventory.quantity`, `LendedShoes`, or `ImageNotifierTable` directly (see [ADR-0004](docs/adr/0004-all-stock-movement-goes-through-lib-stock.md)). It takes a discriminated union keyed on `reason` (`sale`, `borrower-sale`, `cancel`, `retour`, `arrival`, `lend`, `return`, `correction`) and an optional `exec` to enlist in a caller's transaction.

1. Selling decrements **one unit per distinct `shoeInventory.id`**, floored at zero; cancel/retour adds it back exactly.
2. A borrower-placed order also inserts a `-1` `LendedShoes` row (and `+1` on cancel/retour), so the borrower's holdings drop while the owner's store count is untouched. `lend`/`return` move `LendedShoes` only — they never touch `shoeInventory.quantity` (a Borrower is a Storage Location, not a sale — see [ADR-0003](docs/adr/0003-borrower-ledger-is-a-location-ledger.md)).
3. The gallery notifier (folded into the same module) fires **only when Physical Quantity (`shoeInventory.quantity`) crosses the zero boundary** — `"remove"` when stock just hit 0, `"restock"` when it was 0 before the increment. Never key a gallery decision off Store-Held Stock (`lib/stock/availability.ts`); that governs lending, not sellability.

### Delivery providers

[lib/delivery/](lib/delivery/) abstracts the shipping companies behind `DeliveryProvider` (`createOrder` / `deleteOrder` / `fetchStatuses`). Route handlers call `getProvider(order.provider)` and never talk to a courier API directly.

- **DHD (Ecotrack)** — `platform.dhd-dz.com/api/v1`, default provider; `fetchStatuses` returns every parcel and ignores the trackings hint.
- **Yalidine** — built on [lib/Yalidin/parcel.ts](lib/Yalidin/parcel.ts); needs Yalidine's own commune spelling + `stopdeskId`, resolved from `yalidine_communes`. Parts of it are still unverified against the live API (see [PAGES-TO-CHECK.md](PAGES-TO-CHECK.md)); `YALIDINE_FROM_WILAYA` sets the origin.
- `GET /api/status` fans out to every provider, tolerates individual provider failures, and only updates orders whose id already exists in our table (parcels created manually in a courier dashboard are ignored).
- Coverage data is refreshed from `/admin/settings` via `POST /api/settings/sync/{dhd,yalidine}`.

### Pricing & money

Prices are **integer DZD**, resolved 3 levels root-to-leaf via `resolveProductPrice`/`resolveCompareAtPrice` in [lib/helpers.ts](lib/helpers.ts): `shoeInventory.priceOverride` (size) → `shoes.priceOverride` (color) → `shoeModels.basePrice` (model), first non-null wins ([ADR-0002](docs/adr/0002-model-level-pricing.md), which superseded the older variant-level scheme). Products with `minPrice <= 0` are unpriced and excluded from public storefront reads by default. `ordersTable.montant` is a `varchar` (provider-shaped) and is cast to numeric in SQL for analytics. Display helpers (`formatDA`, `formatCompact`, chart palette) live in [lib/format.ts](lib/format.ts). Analytics revenue = `SUM(montant)` of **delivered** orders only; store sales carry no amount and are counted as units.

### Image uploads (Cloudflare R2)

[lib/r2.ts](lib/r2.ts) uses the S3 SDK against `<accountId>.r2.cloudflarestorage.com`.

Uploads are transformed at write time ([ADR-0007](docs/adr/0007-uploaded-images-are-transformed-at-write-time.md)): the browser downscales to 2000px ([lib/images/downscale.ts](lib/images/downscale.ts)), `POST /api/r2/upload` runs sharp, and three webp **Renditions** (400/800/1600) are stored — the uploaded file is not kept. `POST /api/r2/presigned-url` is now only the fallback for a browser that cannot downscale, and what it stores is a legacy single object.

Renditions are addressed **by convention**, not recorded: the stored key ends `_800.webp` and the other two are that key with the width swapped ([lib/images/renditions.ts](lib/images/renditions.ts)). That is what lets `images.loader: "custom"` ([lib/images/loader.ts](lib/images/loader.ts)) resolve them from a `src` string alone. The ~327 rows uploaded before ADR-0007 have no renditions and pass through the loader untouched — every function in `renditions.ts` must stay total over them, which is what [tests/images/renditions.test.ts](tests/images/renditions.test.ts) pins down. A delete removes all three keys via `deleteRenditions`. The S3 endpoint is confined to authenticated calls (put/delete/presign) — it cannot serve public GETs. Browser-facing URLs are built by `buildR2PublicUrl(key)` from **`R2_PUBLIC_URL`** (a custom domain bound to the bucket, or `https://pub-<hash>.r2.dev`), which throws rather than falling back if it is unset or still points at `.r2.cloudflarestorage.com`. `POST /api/admin/images` derives the stored `url` from the key server-side and ignores any client-supplied url, so the R2 object key in `shoeImages.cloudflareImageId` is the single source of truth. After changing `R2_PUBLIC_URL`, rewrite existing rows with `npx tsx lib/scripts/fixR2ImageUrls.ts --apply`.

## Known rough edges

- **`revalidatePath` targets must use the `/admin/...` paths.** Every call was repointed after the admin dashboard moved out of `/`; a bare `revalidatePath("/")` now refreshes the *storefront*, not the inventory listing. Storefront pages read the database directly in Server Components (there is no catalog API — the `/api/products*` routes were deleted in issue #19), so they need no revalidation — admin pages do.
- `PAGES-TO-CHECK.md`, `storefront_plan.md`, and `yalidinplan.md` predate the move and name some routes that no longer exist (e.g. `/admin/inventory`; the real edit page is `/admin/products/[shoeId]/edit`).
- [ADR-0001](docs/adr/0001-storefront-routing-and-pricing-model.md) §1 (data-driven hero) and §3 (variant-level pricing) are superseded by [ADR-0002](docs/adr/0002-model-level-pricing.md) — the hero is a static hardcoded component, and pricing resolution is the 3-level scheme in Pricing & money above, not ADR-0001's `priceOverride → basePrice → 0`.
- `lib/dhdHelpers/` and `lib/Yalidin/*.ts` (other than `parcel.ts`) are one-off `npx tsx` data-munging scripts, not app code.

## Environment

`.env` at the repo root: `DATABASE_URL` (Neon), `NEXT_PUBLIC_DHD_API_KEY`, `YALIDINE_API_ID` / `YALIDINE_API_ID_TOKEN` / `YALIDINE_API_ID_URL` / `YALIDINE_FROM_WILAYA`, `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` / `R2_PUBLIC_URL` (legacy `NEXT_PUBLIC_R2_PUBLIC_URL` is still read as a fallback), `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_WHATSAPP_NUMBER`, `FB_PIXEL_ID`, plus the auth trio `ADMIN_PASSWORD` / `AUTH_SECRET` / `CRON_SECRET`. See [.env.example](.env.example) for the full list. `NEXT_PUBLIC_BASE_URL` now feeds SEO canonicals only — the storefront reads the database directly and has no catalog API to fetch.

`FB_PIXEL_ID` is deliberately **not** `NEXT_PUBLIC_` and deliberately not an editable field on `/admin/settings` — `/admin` has no authentication, so a DB-backed pixel id would be a public write endpoint for anyone to repoint the storefront's tracking. It is read in [app/(storefront)/layout.tsx](<app/(storefront)/layout.tsx>) and passed down as a prop; unset means no tracking script renders at all. See the header comment on [components/storefront/PurchaseTracker.tsx](components/storefront/PurchaseTracker.tsx) for why Meta's revenue figure will not match `/admin/analytics`.

## Working conventions (from AGENTS.md)

- **Issues and specs live in GitHub Issues**, driven by the `gh` CLI — see [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md) and the label vocabulary in [docs/agents/triage-labels.md](docs/agents/triage-labels.md).
- **[CONTEXT.md](CONTEXT.md) is the domain glossary** and `docs/adr/` holds accepted decisions. Read the ADRs covering an area before changing it, use the glossary's exact terms in issues/tests/proposals, and if a change contradicts an ADR say so explicitly rather than silently overriding it.
- **`docs/perf/` holds dated performance baselines** — measured numbers for the storefront, each with the method needed to re-run it. They are diagnoses, not decisions: nothing there is binding, and a stale one is just an old measurement. Newest first: [baseline-2026-09-08.md](docs/perf/baseline-2026-09-08.md).
