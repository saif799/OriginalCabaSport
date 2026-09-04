import { db, type Executor } from "@/lib/db";
import { shoes, shoeInventory, shoeModels, shoeImages } from "@/lib/schema";
import { eq, gt, inArray, asc, sql, and, or, gte, lte, ilike, type SQL } from "drizzle-orm";
import { resolveProductPrice, resolveCompareAtPrice } from "@/lib/helpers";

/** Search text, model/size membership and a price range — all resolved in SQL. */
export type StorefrontProductFilters = {
  search?: string;
  modelIds?: string[];
  sizes?: string[];
  minPrice?: number;
  maxPrice?: number;
};

export type StorefrontProductSize = {
  inventoryId: string;
  size: string;
  quantity: number;
  resolvedPrice: number;
};

export type StorefrontProduct = {
  shoeId: string;
  modelId: string;
  modelName: string;
  color: string;
  price: number;
  compareAtPrice: number | null;
  /** Minimum resolved price across all in-stock sizes (used on catalog cards) */
  minPrice: number;
  primaryImageUrl: string | null;
  primaryImageAlt: string | null;
  sizes: StorefrontProductSize[];
  /** MAX(shoeInventory.createdAt) as a YYYY-MM-DD string; drives the "Nouveautés" sort */
  newestAt: string;
};

export type StorefrontProductDetail = {
  shoeId: string;
  modelId: string;
  modelName: string;
  color: string;
  price: number;
  compareAtPrice: number | null;
  images: { url: string; altText: string | null }[];
  sizes: StorefrontProductSize[];
};

type Row = {
  inventoryId: string;
  shoeId: string;
  modelId: string;
  color: string;
  modelBasePrice: number;
  modelCompareAtPrice: number | null;
  shoePriceOverride: number | null;
  shoeCompareAtPriceOverride: number | null;
  sizePriceOverride: number | null;
  quantity: number;
  size: string;
  modelName: string;
  createdAt: string;
};

/** The resolved unit price, `size override -> color override -> model base`, computed in SQL. */
const resolvedPriceSql = sql<number>`COALESCE(${shoeInventory.priceOverride}, ${shoes.priceOverride}, ${shoeModels.basePrice})`;

/**
 * A product is "live" when a buyer could actually put it in a basket: it is
 * priced and at least one size is in stock.
 *
 * Curated surfaces (Collections, and the admin picker that badges picks) all
 * ask this same question, so it is defined once here rather than re-inlined
 * per caller — the two copies that preceded this had already begun to drift.
 */
export function isLive(product: StorefrontProduct): boolean {
  return product.minPrice > 0 && product.sizes.some((s) => s.quantity > 0);
}

/**
 * Archive is a discoverability flag, not a stock flag: it removes a product
 * from every surface a buyer *browses* (catalog, Collections, sitemap,
 * model filter) while leaving its stock, its history and its direct
 * `/product/[shoeId]` URL untouched. An archived model retires its colours
 * with it — `baseSelect()` already inner-joins `shoeModels`, so one predicate
 * covers both levels.
 */
function notArchived(): SQL {
  return and(eq(shoes.archived, false), eq(shoeModels.archived, false))!;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** shoeIds with a row matching one of `sizes` — existence, not aggregation. */
function sizeQualifyingShoeIds(e: typeof db, sizes: string[], includeOutOfStock: boolean) {
  return e
    .select({ shoeId: shoes.id })
    .from(shoes)
    .innerJoin(shoeInventory, eq(shoes.id, shoeInventory.shoeId))
    .where(
      and(
        includeOutOfStock ? undefined : gt(shoeInventory.quantity, 0),
        inArray(shoeInventory.size, sizes),
      ),
    );
}

/**
 * shoeIds whose minimum resolved price across ALL qualifying sizes falls in
 * range. Must aggregate over every size, not just ones matching other
 * filters, so this stays a separate qualifying set rather than folding into
 * a single row-level WHERE.
 */
function priceQualifyingShoeIds(
  e: typeof db,
  minPrice: number | undefined,
  maxPrice: number | undefined,
  includeOutOfStock: boolean,
) {
  return e
    .select({ shoeId: shoes.id })
    .from(shoes)
    .innerJoin(shoeInventory, eq(shoes.id, shoeInventory.shoeId))
    .innerJoin(shoeModels, eq(shoes.modelId, shoeModels.id))
    .where(includeOutOfStock ? undefined : gt(shoeInventory.quantity, 0))
    .groupBy(shoes.id)
    .having(
      and(
        minPrice != null ? gte(sql`MIN(${resolvedPriceSql})`, minPrice) : undefined,
        maxPrice != null ? lte(sql`MIN(${resolvedPriceSql})`, maxPrice) : undefined,
      ),
    );
}

/**
 * Row-level conditions (search, model) apply directly since modelName/color
 * are constant per shoe; size/price need the qualifying-set subqueries above
 * since they aggregate across a shoe's sizes. `includeOutOfStock` is threaded
 * through so these subqueries stay consistent with the main query's own
 * quantity condition.
 *
 * NOTE: nothing in production passes `filters` any more — every caller below
 * reaches this with an empty set. The one caller that populated it was
 * `GET /api/products`, deliberately deleted in issue #19 because it published
 * the whole catalog unauthenticated and no page ever called it. The machinery
 * is kept on purpose: it is correct and covered by tests, and moving the
 * Storefront Filtering Tool's semantics server-side will give it a real caller
 * again. Do not delete it as dead code.
 */
function buildFilterConditions(
  e: typeof db,
  filters: StorefrontProductFilters,
  includeOutOfStock: boolean,
) {
  const conditions: (SQL | undefined)[] = [];

  if (filters.search) {
    const pattern = `%${escapeLikePattern(filters.search)}%`;
    conditions.push(or(ilike(shoeModels.modelName, pattern), ilike(shoes.color, pattern)));
  }
  if (filters.modelIds && filters.modelIds.length > 0) {
    conditions.push(inArray(shoes.modelId, filters.modelIds));
  }
  if (filters.sizes && filters.sizes.length > 0) {
    conditions.push(inArray(shoes.id, sizeQualifyingShoeIds(e, filters.sizes, includeOutOfStock)));
  }
  if (filters.minPrice != null || filters.maxPrice != null) {
    conditions.push(
      inArray(
        shoes.id,
        priceQualifyingShoeIds(e, filters.minPrice, filters.maxPrice, includeOutOfStock),
      ),
    );
  }

  return conditions;
}

function baseSelect(e: typeof db = db) {
  return e
    .select({
      inventoryId: shoeInventory.id,
      shoeId: shoes.id,
      modelId: shoes.modelId,
      color: shoes.color,
      modelBasePrice: shoeModels.basePrice,
      modelCompareAtPrice: shoeModels.compareAtPrice,
      shoePriceOverride: shoes.priceOverride,
      shoeCompareAtPriceOverride: shoes.compareAtPriceOverride,
      sizePriceOverride: shoeInventory.priceOverride,
      quantity: shoeInventory.quantity,
      size: shoeInventory.size,
      modelName: shoeModels.modelName,
      createdAt: shoeInventory.createdAt,
    })
    .from(shoes)
    .innerJoin(shoeInventory, eq(shoes.id, shoeInventory.shoeId))
    .innerJoin(shoeModels, eq(shoes.modelId, shoeModels.id));
}

/** `size` is a free-text varchar — sort numerically when possible, else lexically. */
function numericSizeCompare(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b);
}

async function fetchImagesByShoeId(shoeIds: string[], e: typeof db = db) {
  const map = new Map<string, { url: string; altText: string | null }[]>();
  if (shoeIds.length === 0) return map;

  const images = await e
    .select({
      shoeId: shoeImages.shoeId,
      url: shoeImages.url,
      altText: shoeImages.altText,
    })
    .from(shoeImages)
    .where(inArray(shoeImages.shoeId, shoeIds))
    .orderBy(sql`${shoeImages.isPrimary} DESC`, asc(shoeImages.sortOrder), asc(shoeImages.createdAt));

  for (const img of images) {
    const list = map.get(img.shoeId) ?? [];
    list.push({ url: img.url, altText: img.altText });
    map.set(img.shoeId, list);
  }
  return map;
}

function groupRows(rows: Row[]): Map<string, StorefrontProduct> {
  const grouped = new Map<string, StorefrontProduct>();

  for (const row of rows) {
    const resolvedPrice = resolveProductPrice(
      row.modelBasePrice,
      row.shoePriceOverride,
      row.sizePriceOverride,
    );

    let product = grouped.get(row.shoeId);
    if (!product) {
      product = {
        shoeId: row.shoeId,
        modelId: row.modelId,
        modelName: row.modelName,
        color: row.color,
        price: resolveProductPrice(row.modelBasePrice, row.shoePriceOverride, null),
        compareAtPrice: resolveCompareAtPrice(row.modelCompareAtPrice, row.shoeCompareAtPriceOverride),
        minPrice: resolvedPrice,
        primaryImageUrl: null,
        primaryImageAlt: null,
        sizes: [],
        newestAt: row.createdAt,
      };
      grouped.set(row.shoeId, product);
    }

    product.sizes.push({
      inventoryId: row.inventoryId,
      size: row.size,
      quantity: row.quantity,
      resolvedPrice,
    });
    if (resolvedPrice < product.minPrice) product.minPrice = resolvedPrice;
    if (row.createdAt.localeCompare(product.newestAt) > 0) product.newestAt = row.createdAt;
  }

  for (const product of grouped.values()) {
    product.sizes.sort((a, b) => numericSizeCompare(a.size, b.size));
  }

  return grouped;
}

async function attachPrimaryImages(grouped: Map<string, StorefrontProduct>, e: typeof db = db) {
  const imageMap = await fetchImagesByShoeId([...grouped.keys()], e);
  for (const [shoeId, product] of grouped) {
    const imgs = imageMap.get(shoeId);
    if (imgs && imgs.length > 0) {
      product.primaryImageUrl = imgs[0].url;
      product.primaryImageAlt = imgs[0].altText;
    }
  }
}

/**
 * The catalog read path. In stock (quantity > 0) and priced by default;
 * `includeOutOfStock` / `includeUnpriced` are for the admin only (searching
 * the whole catalog to badge picks that wouldn't actually show up live).
 */
export async function getStorefrontProducts(opts?: {
  includeUnpriced?: boolean;
  includeOutOfStock?: boolean;
  filters?: StorefrontProductFilters;
  exec?: Executor;
}): Promise<StorefrontProduct[]> {
  const includeOutOfStock = opts?.includeOutOfStock ?? false;
  const includeUnpriced = opts?.includeUnpriced ?? false;
  const e = (opts?.exec ?? db) as typeof db;

  const rows = await baseSelect(e)
    .where(
      and(
        notArchived(),
        includeOutOfStock ? undefined : gt(shoeInventory.quantity, 0),
        ...buildFilterConditions(e, opts?.filters ?? {}, includeOutOfStock),
      ),
    )
    .orderBy(asc(shoes.id), asc(shoeInventory.size));

  const grouped = groupRows(rows as Row[]);
  await attachPrimaryImages(grouped, e);

  let products = Array.from(grouped.values());
  if (!includeUnpriced) products = products.filter((p) => p.minPrice > 0);

  products.sort((a, b) => {
    const cmp = b.newestAt.localeCompare(a.newestAt);
    return cmp !== 0 ? cmp : a.shoeId.localeCompare(b.shoeId);
  });

  return products;
}

/** Fetches a specific set of products, preserving the order of `shoeIds`. */
export async function getStorefrontProductsByIds(
  shoeIds: string[],
  exec: Executor = db,
): Promise<StorefrontProduct[]> {
  if (shoeIds.length === 0) return [];
  const e = exec as typeof db;

  const rows = await baseSelect(e)
    .where(and(notArchived(), inArray(shoes.id, shoeIds)))
    .orderBy(asc(shoes.id), asc(shoeInventory.size));

  const grouped = groupRows(rows as Row[]);
  await attachPrimaryImages(grouped, e);

  return shoeIds
    .map((id) => grouped.get(id))
    .filter((p): p is StorefrontProduct => p !== undefined);
}

/**
 * Deliberately does NOT filter archived: retiring a product removes it from
 * discovery, but anyone holding the link keeps a working, orderable page.
 */
export async function getStorefrontProductDetail(
  shoeId: string,
  exec: Executor = db,
): Promise<StorefrontProductDetail | null> {
  const e = exec as typeof db;
  const rows = (await baseSelect(e)
    .where(eq(shoes.id, shoeId))
    .orderBy(asc(shoeInventory.size))) as Row[];

  if (rows.length === 0) return null;

  const first = rows[0];
  const images = (await fetchImagesByShoeId([shoeId], e)).get(shoeId) ?? [];

  const sizes = rows
    .map((row) => ({
      inventoryId: row.inventoryId,
      size: row.size,
      quantity: row.quantity,
      resolvedPrice: resolveProductPrice(row.modelBasePrice, row.shoePriceOverride, row.sizePriceOverride),
    }))
    .sort((a, b) => numericSizeCompare(a.size, b.size));

  return {
    shoeId: first.shoeId,
    modelId: first.modelId,
    modelName: first.modelName,
    color: first.color,
    price: resolveProductPrice(first.modelBasePrice, first.shoePriceOverride, null),
    compareAtPrice: resolveCompareAtPrice(first.modelCompareAtPrice, first.shoeCompareAtPriceOverride),
    images,
    sizes,
  };
}

export async function getStorefrontModels(): Promise<{ id: string; modelName: string }[]> {
  return db
    .select({ id: shoeModels.id, modelName: shoeModels.modelName })
    .from(shoeModels)
    .where(eq(shoeModels.archived, false))
    .orderBy(asc(shoeModels.modelName));
}
