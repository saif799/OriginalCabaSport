import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { shoeImages, shoeInventory, shoeModels, shoes } from "@/lib/schema";
import {
  getStorefrontProductDetail,
  getStorefrontProducts,
  getStorefrontProductsByIds,
} from "@/lib/storefront/products";
import { createTestDb, type TestDb } from "../testDb";
import { recordingExec } from "./recordingExec";
import type { Executor } from "@/lib/db";

let db: TestDb;

async function seedModel(modelName: string, basePrice: number, archived = false) {
  const [model] = await db
    .insert(shoeModels)
    .values({ modelName, basePrice, archived })
    .returning();
  return model;
}

async function seedShoe(
  modelId: string,
  color: string,
  priceOverride?: number,
  archived = false,
) {
  const [shoe] = await db
    .insert(shoes)
    .values({ id: `shoe-${crypto.randomUUID()}`, modelId, color, priceOverride, archived })
    .returning();
  return shoe;
}

async function seedInventory(shoeId: string, size: string, quantity: number, priceOverride?: number) {
  const [inv] = await db
    .insert(shoeInventory)
    .values({ shoeId, size, quantity, priceOverride })
    .returning();
  return inv;
}

async function ids(filters: Parameters<typeof getStorefrontProducts>[0]) {
  const products = await getStorefrontProducts({ ...filters, exec: db as unknown as Executor });
  return products.map((p) => p.shoeId).sort();
}

beforeEach(async () => {
  db = await createTestDb();
});

describe("getStorefrontProducts: SQL-resolved filters", () => {
  it("returns everything in stock and priced when no filters are given", async () => {
    const modelA = await seedModel("Air Force 1", 5000);
    const shoeA1 = await seedShoe(modelA.id, "White");
    await seedInventory(shoeA1.id, "40", 2);
    await seedInventory(shoeA1.id, "41", 0); // out of stock size

    const shoeA2 = await seedShoe(modelA.id, "Black", 6000);
    await seedInventory(shoeA2.id, "42", 3);

    const unpriced = await seedModel("Unpriced Model", 0);
    const shoeC1 = await seedShoe(unpriced.id, "Grey");
    await seedInventory(shoeC1.id, "40", 2);

    expect(await ids({})).toEqual([shoeA1.id, shoeA2.id].sort());
  });

  it("filters by search text against model name or color, case-insensitively", async () => {
    const modelA = await seedModel("Air Force 1", 5000);
    const shoeA1 = await seedShoe(modelA.id, "White");
    await seedInventory(shoeA1.id, "40", 2);
    const shoeA2 = await seedShoe(modelA.id, "Black", 6000);
    await seedInventory(shoeA2.id, "42", 3);

    const modelB = await seedModel("Air Max", 8000);
    const shoeB1 = await seedShoe(modelB.id, "Red");
    await seedInventory(shoeB1.id, "40", 1, 7000);

    expect(await ids({ filters: { search: "air force" } })).toEqual([shoeA1.id, shoeA2.id].sort());
    expect(await ids({ filters: { search: "black" } })).toEqual([shoeA2.id]);
  });

  it("filters by modelId", async () => {
    const modelA = await seedModel("Air Force 1", 5000);
    const shoeA1 = await seedShoe(modelA.id, "White");
    await seedInventory(shoeA1.id, "40", 2);

    const modelB = await seedModel("Air Max", 8000);
    const shoeB1 = await seedShoe(modelB.id, "Red");
    await seedInventory(shoeB1.id, "40", 1);

    expect(await ids({ filters: { modelIds: [modelA.id] } })).toEqual([shoeA1.id]);
  });

  it("filters by size, matching only sizes that are actually in stock", async () => {
    const modelA = await seedModel("Air Force 1", 5000);
    const shoeA1 = await seedShoe(modelA.id, "White");
    await seedInventory(shoeA1.id, "40", 2);
    await seedInventory(shoeA1.id, "41", 0); // in the table, but zero quantity

    const modelB = await seedModel("Air Max", 8000);
    const shoeB1 = await seedShoe(modelB.id, "Red");
    await seedInventory(shoeB1.id, "40", 1, 7000);
    await seedInventory(shoeB1.id, "43", 5);

    expect(await ids({ filters: { sizes: ["40"] } })).toEqual([shoeA1.id, shoeB1.id].sort());
    expect(await ids({ filters: { sizes: ["41"] } })).toEqual([]);
  });

  it("filters by price range using the minimum resolved price across all in-stock sizes", async () => {
    const modelA = await seedModel("Air Force 1", 5000);
    const shoeA1 = await seedShoe(modelA.id, "White"); // minPrice 5000
    await seedInventory(shoeA1.id, "40", 2);
    const shoeA2 = await seedShoe(modelA.id, "Black", 6000); // minPrice 6000
    await seedInventory(shoeA2.id, "42", 3);

    const modelB = await seedModel("Air Max", 8000);
    const shoeB1 = await seedShoe(modelB.id, "Red"); // sizes 7000/8000 -> minPrice 7000
    await seedInventory(shoeB1.id, "40", 1, 7000);
    await seedInventory(shoeB1.id, "43", 5);

    expect(await ids({ filters: { minPrice: 6000 } })).toEqual([shoeA2.id, shoeB1.id].sort());
    expect(await ids({ filters: { maxPrice: 6000 } })).toEqual([shoeA1.id, shoeA2.id].sort());
    expect(await ids({ filters: { minPrice: 6000, maxPrice: 7000 } })).toEqual(
      [shoeA2.id, shoeB1.id].sort(),
    );
  });

  it("computes the price-range minimum over every in-stock size, not just sizes matched by another filter", async () => {
    // D1's overall minPrice is 3000 (from size 41), even though size 40 alone
    // resolves to 9000. A size filter must not narrow the rows used to
    // compute the price aggregate.
    const modelD = await seedModel("Jordan 1", 3000);
    const shoeD1 = await seedShoe(modelD.id, "Blue");
    await seedInventory(shoeD1.id, "40", 1, 9000);
    await seedInventory(shoeD1.id, "41", 1);

    expect(await ids({ filters: { sizes: ["40"], minPrice: 5000 } })).toEqual([]);
    expect(await ids({ filters: { sizes: ["40"], maxPrice: 3500 } })).toEqual([shoeD1.id]);
  });

  it("excludes unpriced products regardless of filters", async () => {
    const unpriced = await seedModel("Unpriced Model", 0);
    const shoeC1 = await seedShoe(unpriced.id, "Grey");
    await seedInventory(shoeC1.id, "40", 2);

    expect(await ids({ filters: { search: "unpriced" } })).toEqual([]);
    expect(await ids({ filters: { minPrice: 0 } })).toEqual([]);
  });

  it("combines search, model, size and price filters with AND semantics", async () => {
    const modelA = await seedModel("Air Force 1", 5000);
    const shoeA1 = await seedShoe(modelA.id, "White");
    await seedInventory(shoeA1.id, "40", 2);
    const shoeA2 = await seedShoe(modelA.id, "Black", 6000);
    await seedInventory(shoeA2.id, "42", 3);

    const result = await ids({
      filters: { search: "air force", modelIds: [modelA.id], sizes: ["42"], minPrice: 6000 },
    });
    expect(result).toEqual([shoeA2.id]);
  });
});

describe("archived products", () => {
  it("hides an archived shoe from the catalog", async () => {
    const model = await seedModel("Air Force 1", 5000);
    const live = await seedShoe(model.id, "White");
    await seedInventory(live.id, "40", 2);
    const retired = await seedShoe(model.id, "Black", undefined, true);
    await seedInventory(retired.id, "42", 3);

    expect(await ids({})).toEqual([live.id]);
  });

  it("hides every colour of an archived model, even un-archived ones", async () => {
    const model = await seedModel("Retired Model", 5000, true);
    const shoe = await seedShoe(model.id, "White");
    await seedInventory(shoe.id, "40", 2);

    expect(await ids({})).toEqual([]);
    expect(await ids({ filters: { search: "retired" } })).toEqual([]);
  });

  it("drops an archived shoe out of a Collection's picks", async () => {
    const model = await seedModel("Air Force 1", 5000);
    const live = await seedShoe(model.id, "White");
    await seedInventory(live.id, "40", 2);
    const retired = await seedShoe(model.id, "Black", undefined, true);
    await seedInventory(retired.id, "42", 3);

    const pinned = await getStorefrontProductsByIds(
      [live.id, retired.id],
      db as unknown as Executor,
    );
    expect(pinned.map((p) => p.shoeId)).toEqual([live.id]);
  });

  it("keeps the direct product page working for an archived shoe", async () => {
    const model = await seedModel("Air Force 1", 5000);
    const retired = await seedShoe(model.id, "Black", undefined, true);
    await seedInventory(retired.id, "42", 3);

    const detail = await getStorefrontProductDetail(retired.id, db as unknown as Executor);
    expect(detail?.shoeId).toBe(retired.id);
    expect(detail?.sizes.map((s) => s.size)).toEqual(["42"]);
  });
});

/**
 * `getStorefrontProductDetail` memoises its default path per request; an
 * explicit `exec` must never be served from that cache. Asserted as the one
 * externally observable consequence — a mutation between two reads is seen —
 * rather than by counting queries or spying on the driver.
 *
 * Worth knowing what this does and does not catch: React's `cache` is an
 * unconditional passthrough outside a server request, so under Vitest it never
 * memoises anything. A hand-rolled memo that forgot `exec` fails here; one
 * built on React's `cache` would slip past. The wrapper's `exec === db` branch
 * is the real guarantee, and this is the backstop for replacing it.
 */
describe("getStorefrontProductDetail: an explicit executor bypasses memoisation", () => {
  it("observes a row mutated between two reads through the same exec", async () => {
    const exec = db as unknown as Executor;
    const model = await seedModel("Air Force 1", 5000);
    const shoe = await seedShoe(model.id, "White");
    const inv = await seedInventory(shoe.id, "42", 3);

    const before = await getStorefrontProductDetail(shoe.id, exec);
    expect(before?.sizes[0].quantity).toBe(3);

    await db.update(shoeInventory).set({ quantity: 0 }).where(eq(shoeInventory.id, inv.id));

    const after = await getStorefrontProductDetail(shoe.id, exec);
    expect(after?.sizes[0].quantity).toBe(0);
  });
});

async function seedImage(shoeId: string, url: string, isPrimary = false, sortOrder = 0) {
  await db.insert(shoeImages).values({
    shoeId,
    cloudflareImageId: `products/shoes/${shoeId}/${url}`,
    url,
    isPrimary,
    sortOrder,
  });
}

/**
 * Issue #20: the row read and the image read are keyed by the same `shoeId`
 * argument, so neither has to wait for the other. These pin the *ordering* of
 * the query traffic — both reads started before either settled — which is what
 * "they run concurrently" actually means here. Asserted on event order rather
 * than wall-clock duration so it cannot flake in CI.
 */
describe("storefront reads issue their independent queries concurrently", () => {
  it("getStorefrontProductsByIds starts the image read without waiting for the rows", async () => {
    const model = await seedModel("Air Force 1", 5000);
    const shoe = await seedShoe(model.id, "White");
    await seedInventory(shoe.id, "42", 3);
    await seedImage(shoe.id, "white.webp", true);

    const { exec, log } = recordingExec(db);
    const products = await getStorefrontProductsByIds([shoe.id], exec);

    expect(products.map((p) => p.primaryImageUrl)).toEqual(["white.webp"]);
    expect(log).toHaveLength(4);
    // Two distinct queries, both started before either settled. Re-serialising
    // yields ["start", "settle", ...] here and fails. Which of the two starts
    // first is deliberately not pinned: that depends only on the order the
    // arguments to Promise.all are evaluated in, not on the property at stake.
    expect(log.slice(0, 2).map((e) => e.event)).toEqual(["start", "start"]);
    expect(new Set(log.slice(0, 2).map((e) => e.index)).size).toBe(2);
  });

  it("getStorefrontProductDetail starts the image read without waiting for the rows", async () => {
    const model = await seedModel("Air Force 1", 5000);
    const shoe = await seedShoe(model.id, "White");
    await seedInventory(shoe.id, "42", 3);
    await seedImage(shoe.id, "white.webp", true);

    const { exec, log } = recordingExec(db);
    const detail = await getStorefrontProductDetail(shoe.id, exec);

    expect(detail?.images.map((i) => i.url)).toEqual(["white.webp"]);
    expect(log).toHaveLength(4);
    expect(log.slice(0, 2).map((e) => e.event)).toEqual(["start", "start"]);
    expect(new Set(log.slice(0, 2).map((e) => e.index)).size).toBe(2);
  });
});

/**
 * The image read is keyed by the *argument* ids, so it deliberately over-reads:
 * it fetches images for ids the row query drops (archived) or never had (bogus).
 * Those rows are discarded on attach. This pins that the widening stays invisible
 * in the output — it is a bounded overread traded for a round-trip, not a leak.
 */
describe("the widened image read does not change what the reads return", () => {
  it("keeps archived and unknown ids out of getStorefrontProductsByIds despite fetching their images", async () => {
    const model = await seedModel("Air Force 1", 5000);
    const live = await seedShoe(model.id, "White");
    await seedInventory(live.id, "42", 3);
    await seedImage(live.id, "white.webp", true);

    const retired = await seedShoe(model.id, "Black", undefined, true);
    await seedInventory(retired.id, "43", 3);
    await seedImage(retired.id, "black.webp", true);

    const products = await getStorefrontProductsByIds(
      [retired.id, "no-such-shoe", live.id],
      db as unknown as Executor,
    );

    expect(products.map((p) => p.shoeId)).toEqual([live.id]);
    expect(products[0].primaryImageUrl).toBe("white.webp");
  });

  it("still returns null from getStorefrontProductDetail for an unknown shoeId", async () => {
    expect(await getStorefrontProductDetail("no-such-shoe", db as unknown as Executor)).toBeNull();
  });
});

/**
 * Image order — primary first, then sortOrder, then createdAt — is the one
 * piece of behaviour the widened image read is closest to disturbing: it now
 * fetches several shoes' images in one pass keyed by argument ids, and the
 * grouping that splits them per shoe runs against a longer result set. The
 * ordering was previously unpinned by any test, so these seed *interleaved*
 * shoes: rows for both come back in one ORDER BY, and a grouping that mixed
 * them up or preserved the raw row order would show here.
 */
describe("image order survives the widened read", () => {
  it("gives the product detail its images primary-first, then by sortOrder", async () => {
    const model = await seedModel("Air Force 1", 5000);
    const shoe = await seedShoe(model.id, "White");
    await seedInventory(shoe.id, "42", 3);

    // Seeded in an order that matches neither sortOrder nor primary-first.
    await seedImage(shoe.id, "third.webp", false, 20);
    await seedImage(shoe.id, "primary.webp", true, 99);
    await seedImage(shoe.id, "second.webp", false, 10);

    const detail = await getStorefrontProductDetail(shoe.id, db as unknown as Executor);
    expect(detail?.images.map((i) => i.url)).toEqual([
      "primary.webp",
      "second.webp",
      "third.webp",
    ]);
  });

  it("picks each product's own primary as its thumbnail when several are read at once", async () => {
    const model = await seedModel("Air Force 1", 5000);
    const white = await seedShoe(model.id, "White");
    await seedInventory(white.id, "42", 3);
    const black = await seedShoe(model.id, "Black");
    await seedInventory(black.id, "43", 3);

    await seedImage(white.id, "white-alt.webp", false, 0);
    await seedImage(black.id, "black-primary.webp", true, 50);
    await seedImage(white.id, "white-primary.webp", true, 50);
    await seedImage(black.id, "black-alt.webp", false, 0);

    const products = await getStorefrontProductsByIds(
      [black.id, white.id],
      db as unknown as Executor,
    );

    expect(products.map((p) => [p.shoeId, p.primaryImageUrl])).toEqual([
      [black.id, "black-primary.webp"],
      [white.id, "white-primary.webp"],
    ]);
  });
});
