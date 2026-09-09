# Storefront performance: after issue #20 — 2026-09-09

Re-measurement of the two changes made for issue #20, which acted on findings
**1** and **2** of the [2026-09-08 baseline](baseline-2026-09-08.md):

1. `getStorefrontProductsByIds` and `getStorefrontProductDetail` now issue their
   row read and their image read together instead of chaining them.
2. Cairo is declared with `preload: false`, so its glyph files are fetched only
   by a page that actually resolves `--sf-font` onto it — i.e. only `/ar`.

Method is the baseline's, unchanged: `pnpm build` + `pnpm start` on
`localhost:3000`, `npx lighthouse` default **mobile** profile, headless Chrome,
**3 runs per page, median**; the same pinned product `a5370eb7009`; query
timings from a throwaway `tsx` script passing a second `neon-http` client as
`exec` (so React `cache()` does not turn warm iterations into no-ops) with
`globalThis.fetch` wrapped to count round-trips. `KB` is 1024 bytes.

The same local-run caveat applies: **byte weights are truthful, latency is
comparable only to itself.** In particular the absolute latencies below are
*lower across the board* than 2026-09-08's, including on code paths this change
did not touch — the network was simply better today. That is why the query
section reports a **same-session before/after**, taken back to back on this
machine minutes apart, rather than comparing to yesterday's numbers.

## Server-side time — the headline

10 warm iterations, median, against the production Neon database. "Before" was
taken by stashing only `lib/storefront/products.ts` and re-running the same
harness, so the two rows differ in nothing but the change.

| Query | Before | After | Δ |
|---|---|---|---|
| `getVisibleCollections()` | 269 ms, 4 queries in **4** round-trip generations | 219 ms, 4 queries in **3** generations | **−50 ms** |
| `getStorefrontProductDetail()` | 127 ms, 2 queries in **2** generations | 75 ms, 2 queries in **1** generation | **−52 ms** |

A confirming second "after" run four minutes later: 216 ms / 76 ms.

**The round-trip counts are the durable result.** The query *count* is unchanged
— 4 and 2, same as before — but they now go out in 3 waves and 1 wave. That is
exactly what the issue specified, and it is not a latency-dependent claim.

**The millisecond figures are not durable and should not be quoted as "the
saving".** The baseline predicted ~81 ms off home and ~78 ms off product from
`323 ÷ 4`. What landed was ~50 ms on each, because a round-trip cost ~53 ms
today rather than ~81 ms — the whole 4-generation chain was 269 ms today against
323 ms yesterday. The prediction that held is *one round-trip removed*; what
that is worth is whatever a round-trip costs on the day, and for a customer
further from Frankfurt than this machine it is worth **more**, not less.

Unthrottled `curl` TTFB, for continuity with the baseline's 369 ms (home) /
307 ms (product): **~250 ms** home, **~113 ms** product (5 samples each; home's
first two discarded as cold). This is *not* a controlled before/after — the
server was never re-measured on the old code — so read it as consistent with the
query numbers, not as evidence on its own.

## Payload — fonts, and nothing else

| Home `/fr` | 2026-09-08 | 2026-09-09 | Δ |
|---|---|---|---|
| Requests | 38 | **36** | −2 |
| Transfer | 485.9 KB | **422.7 KB** | **−63.2 KB** |
| Fonts | 5 reqs, 93.0 KB | **3 reqs, 29.6 KB** | −2 reqs, −63.4 KB |

| Product | 2026-09-08 | 2026-09-09 | Δ |
|---|---|---|---|
| Requests | 40 | **38** | −2 |
| Transfer | 450.3 KB | **386.6 KB** | **−63.7 KB** |
| Fonts | 5 reqs, 93.0 KB | **3 reqs, 29.6 KB** | −2 reqs, −63.4 KB |

Every other kind is **byte-identical** to the baseline — home JS 15 reqs /
192.1 KB, CSS 23.1 KB, images 141.0 KB; product JS 19 reqs / 227.7 KB, CSS
23.1 KB, images 64.4 KB. The only thing that moved is the two Cairo files.
Fonts fall from 19% of home's transfer weight to 7%.

`/ar` still fetches all five (one run, for the check only): 38 requests,
490.3 KB, **Fonts 5 reqs / 93.0 KB**; score 83, FCP 1565 ms, LCP 3910 ms,
CLS 0.0013. The two extra files are the Cairo faces,
and their filenames lack the `-s.p.` infix Next gives a preloaded file — they
are fetched on use, which is the whole point.

### The font check, in the browser

On `/fr`: three font files fetched, and every Cairo `FontFace` reports
`status: "unloaded"`. `--sf-font` on `<html>` resolves to the DM Mono chain.

On `/ar/product/a5370eb7009`: Cairo 400 and 500 both `loaded`,
`document.fonts.check('400 16px Cairo', 'الولاية')` is `true`, and — the case
that would expose a scoping mistake — an open Radix Select's portal-mounted
option computes
`font-family: Cairo, "Cairo Fallback", "Noto Kufi Arabic", "Segoe UI", sans-serif`.
Portal content is still drawn in Cairo. `/admin` is untouched: it resolves
`--font-sans` through `--font-dm-mono` and never named Cairo.

**Does dropping the preload cost `/ar` a reflow?** The fallback window is longer
now, so it is a fair question. The `/ar` run's **CLS is 0.0013** and Lighthouse's
`layout-shift-elements` audit returns nothing, so no shift was attributable to
anything, font swap included. That is one run and it is not proof — but the
mechanism is understood: `next/font` generates a `Cairo Fallback` face with
size-adjust metrics and puts it ahead of our own chain, which is visible in the
computed style quoted above. Two caveats worth writing down rather than
discovering later: this was measured on `/ar`'s **homepage**, not a text-dense
page, and Lighthouse loads cold, so it never sees the cached-font case where the
swap does not happen at all.

## Page metrics (median of 3)

| | Home 09-08 | Home 09-09 | Product 09-08 | Product 09-09 |
|---|---|---|---|---|
| Performance score | 87 | **91** | 81 | **79** |
| FCP | 1224 ms | 1228 ms | 1226 ms | 1240 ms |
| LCP | 3815 ms | **3388 ms** | 4006 ms | 3933 ms |
| TBT | 99 ms | 120 ms | 320 ms | 370 ms |
| Speed Index | 1901 ms | 1771 ms | 1899 ms | 1831 ms |
| TTFB (throttled) | 712 ms | 667 ms | 465 ms | 399 ms |
| CLS | 0.000 | 0.000 | 0.000 | 0.000 |

Read this table cautiously. Three runs give a spread, not a confidence interval —
home's three LCPs were 3388 / 3242 / 3508 ms and its scores 91 / 92 / 88 — and
the baseline recorded medians only, so there is no spread to compare against.

- **LCP** — the one question finding 3 was owed. Home's median moved down
  ~430 ms, product's ~70 ms. The direction is plausible (two fewer requests
  competing for a throttled 1.6 Mbps pipe, and ~50 ms less server time), but
  home's own run-to-run spread is ~270 ms, so three runs do not establish the
  magnitude. Treat this as "the font change did not make LCP worse, and probably
  helped home" — not as a measured LCP win. LCP is still ~3.4–3.9 s against a
  2500 ms threshold, and **finding 3 is still open**: the
  `largest-contentful-paint-element` audit still returns nothing, so the LCP
  element is still unidentified.
- **TBT rose on both pages** (99→120, 320→370 ms). Nothing here touches client
  JS — the script payload is byte-identical — so this is machine noise, and it is
  what drags the product score from 81 to 79 despite that page being strictly
  faster and lighter. Product TBT remains finding 6, untouched.

## What did not change

Deliberately, and verified by the existing storefront suite: the products
returned and their order, image ordering, price resolution, the three Collection
not-showing states, and archived products still reachable by direct URL.
`getStorefrontProducts` (the catalog read) still chains its image fetch, because
there the shoeIds genuinely are not known until the row query returns.
`force-dynamic` stays on all four storefront pages; nothing was cached. The
React `cache()` wrappers are untouched.

## Open questions this note does not answer

Everything the baseline left open. Findings 3–7 all stand: the LCP element, the
hero's weight, the ~25 KB of unused shared-chunk JS, product-page TBT, and the
1.8–3.2 s cold first call. Plus, still:

- **Caching the grid / dropping `force-dynamic`** — the largest remaining lever
  on finding 1, and a stock-freshness decision rather than a performance one.
- **Collapsing collections→items→products into a join or CTE** — the homepage's
  3 remaining round-trip generations are now all genuine dependencies, so this is
  the only way left to shorten that chain.
- **What `/ar` costs.** It is now the only locale paying for Cairo, and it has
  never been measured beyond the single font-check run above.
