# ADR 0002: Model-Level Pricing

## Status
Accepted — supersedes ADR-0001 §3 (Variant Pricing Architecture)

## Context
ADR-0001 put `base_price`/`compare_at_price` on `shoes` (the colour variant). In
practice a model sold in several colours at one price had to be priced once per
colour, and every new colour started unpriced. Pricing belongs on the model,
with overrides only where a colour or a specific size genuinely differs.

ADR-0001 §1 is also superseded: the storefront hero (originally implied to be
data-driven) is now a static, hardcoded component — no hero table, no hero
admin.

## Decision
1. **3-level price resolution**, root to leaf:
   - `shoe_models.base_price` (integer DZD, default `0`) / `shoe_models.compare_at_price` (nullable integer DZD) — the model's price.
   - `shoes.price_override` / `shoes.compare_at_price_override` (nullable integer DZD) — optional colour-level override.
   - `shoe_inventory.price_override` (nullable integer DZD, unchanged) — optional size-level override.
   - Resolution: size override → colour override → model base. First non-null wins. See `resolveProductPrice` / `resolveCompareAtPrice` in `lib/helpers.ts`.
2. **No backfill.** The migration (`pnpm push`) drops `shoes.base_price` / `shoes.compare_at_price` and adds the new columns with `base_price` defaulting to `0`. Every product is therefore unpriced immediately after migration and hidden from the storefront until re-priced in `/admin/products`. This was a deliberate, agreed trade-off — not a bug — to avoid guessing which colour's price should become the model's price.
3. Unpriced products (`minPrice <= 0`) are excluded from all public storefront reads by default; the admin can request them explicitly to build the "N products have no price" list.

## Consequences
- Pricing a model once prices every colour that has no override; correcting a single colour or size no longer requires touching every other variant.
- Every historical price was lost; the admin was rebuilt (`/admin/products`) to make re-pricing fast and to make the previously URL-only edit page discoverable.
- Every read/write path that touched `shoes.basePrice`/`shoes.compareAtPrice` needed updating: `app/api/products/route.ts`, `app/api/products/[shoeId]/route.ts`, `app/api/admin/products/[shoeId]/route.ts` (now writes overrides), the new `app/api/admin/models/[modelId]/route.ts` (writes the model price), `app/api/arrivals/route.ts` (writes the model price for newly-created colours), and `components/AddShoeForm.tsx`.

## Note (issue #21)
`app/api/arrivals/route.ts` no longer writes the model price: an arrivage never touches `shoe_models.base_price` / `compare_at_price`. A price is set when the model is created (`POST /api/models`, optional) or in `/admin/products`. The resolution chain above is unchanged.
