import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  shoeInventory,
  shoeModels,
  shoes,
  storefrontCollectionItems,
  storefrontCollections,
} from "@/lib/schema";
import {
  collectionSlug,
  getCollectionBySlug,
  getVisibleCollections,
  uniqueCollectionSlug,
} from "@/lib/storefront/collections";
import { createTestDb, type TestDb } from "../testDb";
import type { Executor } from "@/lib/db";

let db: TestDb;
let exec: Executor;

beforeEach(async () => {
  db = await createTestDb();
  exec = db as unknown as Executor;
});

/** A priced, in-stock colour variant — the default "live" pick. */
async function seedLiveShoe(color: string, basePrice = 5000, quantity = 3) {
  const [model] = await db
    .insert(shoeModels)
    .values({ modelName: `Model ${color}`, basePrice })
    .returning();
  const [shoe] = await db
    .insert(shoes)
    .values({ id: `shoe-${crypto.randomUUID()}`, modelId: model.id, color })
    .returning();
  await db.insert(shoeInventory).values({ shoeId: shoe.id, size: "42", quantity });
  return shoe;
}

async function seedCollection(
  values: Partial<typeof storefrontCollections.$inferInsert> & { title: string; slug: string },
) {
  const [collection] = await db
    .insert(storefrontCollections)
    .values({
      imageKey: "collections/hero.jpg",
      imageUrl: "https://cdn.example.com/collections/hero.jpg",
      ...values,
    })
    .returning();
  return collection;
}

async function pick(collectionId: string, shoeId: string, sortOrder = 0) {
  await db
    .insert(storefrontCollectionItems)
    .values({ collectionId, shoeId, sortOrder });
}

describe("collectionSlug", () => {
  it("lowercases and hyphenates", () => {
    expect(collectionSlug("Ja Morant")).toBe("ja-morant");
  });

  it("strips accents rather than dropping the letter", () => {
    expect(collectionSlug("Offres d'été")).toBe("offres-d-ete");
    expect(collectionSlug("Nouveautés")).toBe("nouveautes");
  });

  it("collapses runs of non-alphanumerics into one hyphen and trims the edges", () => {
    expect(collectionSlug("  KD --- 2024 !!  ")).toBe("kd-2024");
  });

  it("falls back rather than returning an empty slug for a title with no ASCII", () => {
    expect(collectionSlug("مجموعاتنا")).toBe("collection");
  });
});

describe("uniqueCollectionSlug", () => {
  it("returns the base slug when nothing has taken it", () => {
    expect(uniqueCollectionSlug("offres", [])).toBe("offres");
  });

  it("suffixes -2, then -3, on collision", () => {
    expect(uniqueCollectionSlug("offres", ["offres"])).toBe("offres-2");
    expect(uniqueCollectionSlug("offres", ["offres", "offres-2"])).toBe("offres-3");
  });
});

describe("slug uniqueness", () => {
  it("is enforced by the database", async () => {
    await seedCollection({ title: "Offres", slug: "offres" });
    await expect(seedCollection({ title: "Offres bis", slug: "offres" })).rejects.toThrow();
  });
});

describe("getVisibleCollections", () => {
  it("resolves picks in curated order, dropping unpriced and sold-out ones", async () => {
    const live = await seedLiveShoe("White");
    const soldOut = await seedLiveShoe("Black", 5000, 0);
    const unpriced = await seedLiveShoe("Grey", 0);

    const collection = await seedCollection({ title: "Suggestions", slug: "suggestions" });
    await pick(collection.id, soldOut.id, 0);
    await pick(collection.id, live.id, 1);
    await pick(collection.id, unpriced.id, 2);

    const [result] = await getVisibleCollections(exec);
    expect(result.products.map((p) => p.shoeId)).toEqual([live.id]);
  });

  it("orders collections by sortOrder", async () => {
    const shoe = await seedLiveShoe("White");
    const second = await seedCollection({ title: "Second", slug: "second", sortOrder: 1 });
    const first = await seedCollection({ title: "First", slug: "first", sortOrder: 0 });
    await pick(second.id, shoe.id);
    await pick(first.id, shoe.id);

    const result = await getVisibleCollections(exec);
    expect(result.map((c) => c.slug)).toEqual(["first", "second"]);
  });

  it("omits an Empty collection — no live pick left", async () => {
    const soldOut = await seedLiveShoe("Black", 5000, 0);
    const empty = await seedCollection({ title: "Empty", slug: "empty" });
    await pick(empty.id, soldOut.id);

    expect(await getVisibleCollections(exec)).toEqual([]);
  });

  it("omits a collection with no picks at all", async () => {
    await seedCollection({ title: "Parked", slug: "parked" });
    expect(await getVisibleCollections(exec)).toEqual([]);
  });

  it("omits an Incomplete collection — no image", async () => {
    const shoe = await seedLiveShoe("White");
    const incomplete = await seedCollection({
      title: "Incomplete",
      slug: "incomplete",
      imageKey: null,
      imageUrl: null,
    });
    await pick(incomplete.id, shoe.id);

    expect(await getVisibleCollections(exec)).toEqual([]);
  });

  it("omits a Hidden collection", async () => {
    const shoe = await seedLiveShoe("White");
    const hidden = await seedCollection({ title: "Hidden", slug: "hidden", isVisible: false });
    await pick(hidden.id, shoe.id);

    expect(await getVisibleCollections(exec)).toEqual([]);
  });
});

describe("getCollectionBySlug", () => {
  it("returns the collection with its live products", async () => {
    const live = await seedLiveShoe("White");
    const soldOut = await seedLiveShoe("Black", 5000, 0);
    const collection = await seedCollection({ title: "Suggestions", slug: "suggestions" });
    await pick(collection.id, live.id, 0);
    await pick(collection.id, soldOut.id, 1);

    const result = await getCollectionBySlug("suggestions", exec);
    expect(result?.title).toBe("Suggestions");
    expect(result?.products.map((p) => p.shoeId)).toEqual([live.id]);
  });

  it("returns null for a slug that does not exist", async () => {
    expect(await getCollectionBySlug("nope", exec)).toBeNull();
  });

  it("returns null for a Hidden collection", async () => {
    const shoe = await seedLiveShoe("White");
    const hidden = await seedCollection({ title: "Hidden", slug: "hidden", isVisible: false });
    await pick(hidden.id, shoe.id);

    expect(await getCollectionBySlug("hidden", exec)).toBeNull();
  });

  it("still serves an Empty collection, with an empty product list", async () => {
    const soldOut = await seedLiveShoe("Black", 5000, 0);
    const empty = await seedCollection({ title: "Empty", slug: "empty" });
    await pick(empty.id, soldOut.id);

    const result = await getCollectionBySlug("empty", exec);
    expect(result?.slug).toBe("empty");
    expect(result?.products).toEqual([]);
  });
});

/**
 * The Collection half of the same constraint — see the note on the matching
 * test in `products.test.ts` for what this style of test can and cannot catch.
 */
describe("getCollectionBySlug: an explicit executor bypasses memoisation", () => {
  it("observes a row mutated between two reads through the same exec", async () => {
    const shoe = await seedLiveShoe("White");
    const collection = await seedCollection({ title: "Suggestions", slug: "suggestions" });
    await pick(collection.id, shoe.id);

    const before = await getCollectionBySlug("suggestions", exec);
    expect(before?.title).toBe("Suggestions");
    expect(before?.products.map((p) => p.shoeId)).toEqual([shoe.id]);

    await db
      .update(storefrontCollections)
      .set({ title: "Renamed" })
      .where(eq(storefrontCollections.id, collection.id));
    await db.update(shoeInventory).set({ quantity: 0 }).where(eq(shoeInventory.shoeId, shoe.id));

    const after = await getCollectionBySlug("suggestions", exec);
    expect(after?.title).toBe("Renamed");
    // The pick resolves through the nested by-ids Product read, so the whole
    // composed result has to be fresh, not just the Collection row.
    expect(after?.products).toEqual([]);
  });
});
