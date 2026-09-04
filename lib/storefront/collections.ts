import { cache } from "react";
import { db, type Executor } from "@/lib/db";
import { storefrontCollections, storefrontCollectionItems } from "@/lib/schema";
import { asc, eq, inArray } from "drizzle-orm";
import { getStorefrontProductsByIds, isLive, type StorefrontProduct } from "./products";
import { collectionSlug, uniqueCollectionSlug } from "./slug";

// Re-exported so `@/lib/storefront/collections` stays the one import for
// callers that need both the slug helpers and the read functions.
export { collectionSlug, uniqueCollectionSlug };

/**
 * A Collection as the storefront renders it: the curated row plus its picks
 * resolved to live products, in curated order. `imageUrl` is null on an
 * *Incomplete* Collection — one saved before its photo was uploaded.
 */
export type CollectionWithProducts = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  products: StorefrontProduct[];
};

/** Derives a free slug for `title` against the slugs currently in the table. */
export async function nextCollectionSlug(title: string, exec: Executor = db): Promise<string> {
  const e = exec as typeof db;
  const rows = await e.select({ slug: storefrontCollections.slug }).from(storefrontCollections);
  return uniqueCollectionSlug(collectionSlug(title), rows.map((r) => r.slug));
}

/** The picks of `collectionIds`, resolved to live products, keyed by collection. */
async function resolvePicks(
  collectionIds: string[],
  exec: Executor,
): Promise<Map<string, StorefrontProduct[]>> {
  const byCollection = new Map<string, StorefrontProduct[]>(collectionIds.map((id) => [id, []]));
  if (collectionIds.length === 0) return byCollection;

  const e = exec as typeof db;
  const items = await e
    .select()
    .from(storefrontCollectionItems)
    .where(inArray(storefrontCollectionItems.collectionId, collectionIds))
    .orderBy(asc(storefrontCollectionItems.sortOrder));

  const products = await getStorefrontProductsByIds(
    [...new Set(items.map((i) => i.shoeId))],
    exec,
  );
  const productByShoeId = new Map(products.map((p) => [p.shoeId, p]));

  for (const item of items) {
    const product = productByShoeId.get(item.shoeId);
    if (product && isLive(product)) byCollection.get(item.collectionId)!.push(product);
  }

  return byCollection;
}

/**
 * The homepage grid: visible, image-bearing, non-empty Collections in curated
 * order.
 *
 * The picks still have to be resolved to build it — an *Empty* Collection (one
 * whose every pick went unpriced or out of stock) is dropped from the grid, and
 * there is no way to know a Collection is empty without asking. The grid is
 * cheaper to render than the rails it replaced, not cheaper to build (ADR-0006).
 */
export async function getVisibleCollections(
  exec: Executor = db,
): Promise<CollectionWithProducts[]> {
  const e = exec as typeof db;
  const collections = await e
    .select()
    .from(storefrontCollections)
    .where(eq(storefrontCollections.isVisible, true))
    .orderBy(asc(storefrontCollections.sortOrder));

  // Incomplete Collections never reach the storefront: the card *is* the image.
  const renderable = collections.filter((c) => c.imageUrl);
  const picks = await resolvePicks(renderable.map((c) => c.id), exec);

  return renderable
    .map((collection) => toCollectionWithProducts(collection, picks.get(collection.id)!))
    .filter((collection) => collection.products.length > 0);
}

/** The query itself — the one implementation both paths below share. */
async function readCollectionBySlug(
  slug: string,
  e: typeof db,
): Promise<CollectionWithProducts | null> {
  const [collection] = await e
    .select()
    .from(storefrontCollections)
    .where(eq(storefrontCollections.slug, slug))
    .limit(1);

  if (!collection || !collection.isVisible) return null;

  const picks = await resolvePicks([collection.id], e);
  return toCollectionWithProducts(collection, picks.get(collection.id)!);
}

/**
 * Request-scoped memoisation of the default path only. `exec` is deliberately
 * NOT a cache key: keying on it would let the PGlite test database and the
 * request database share entries. React's `cache` is per server request by
 * construction, so a Stock Movement is still visible to the very next request.
 * It memoises rejections too: a read that throws in `generateMetadata` is
 * replayed to the body rather than retried.
 *
 * This covers the nested by-ids Product read too — `resolvePicks` runs inside
 * the memoised call — so that read needs no cache of its own.
 */
const cachedCollectionBySlug = cache((slug: string) => readCollectionBySlug(slug, db));

/**
 * A Collection's own page. Null when the slug is unknown or the Collection is
 * *Hidden* — hidden means hidden, its URL stops resolving.
 *
 * An *Empty* Collection returns normally with an empty product list: a link
 * shared to a story outlives the stock it pointed at, and 404ing a link you
 * published yourself is worse than an honest empty state (ADR-0006).
 *
 * A Collection page calls this twice — once for `generateMetadata`, once for
 * the body — and the second call is free.
 */
export function getCollectionBySlug(
  slug: string,
  exec: Executor = db,
): Promise<CollectionWithProducts | null> {
  return exec === db
    ? cachedCollectionBySlug(slug)
    : readCollectionBySlug(slug, exec as typeof db);
}

function toCollectionWithProducts(
  collection: typeof storefrontCollections.$inferSelect,
  products: StorefrontProduct[],
): CollectionWithProducts {
  return {
    id: collection.id,
    slug: collection.slug,
    title: collection.title,
    subtitle: collection.subtitle,
    imageUrl: collection.imageUrl,
    imageAlt: collection.imageAlt,
    products,
  };
}
