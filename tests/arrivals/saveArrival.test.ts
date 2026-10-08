import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  ImageNotifierTable,
  arrivalItems,
  arrivals,
  shoeInventory,
  shoeModels,
  shoes,
  stockMovements,
} from "@/lib/schema";
import { ArrivalError, saveArrival } from "@/lib/arrivals/saveArrival";
import { createTestDb, type TestDb } from "../testDb";
import type { Executor } from "@/lib/db";

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

async function seedModel(
  modelName: string,
  values: Partial<typeof shoeModels.$inferInsert> = {},
) {
  const [model] = await db
    .insert(shoeModels)
    .values({ modelName, ...values })
    .returning();
  return model;
}

async function seedColour(
  modelId: string,
  color: string,
  sizes: Record<string, number> = {},
  values: Partial<typeof shoes.$inferInsert> = {},
) {
  const [shoe] = await db
    .insert(shoes)
    .values({ id: crypto.randomUUID().slice(0, 11), modelId, color, ...values })
    .returning();
  const entries = Object.entries(sizes);
  if (entries.length) {
    await db
      .insert(shoeInventory)
      .values(entries.map(([size, quantity]) => ({ shoeId: shoe.id, size, quantity })));
  }
  return shoe;
}

function save(lines: unknown, extra: { reference?: string; note?: string } = {}) {
  return saveArrival({ ...extra, lines }, db as unknown as Executor);
}

/** Physical Quantity of every size of one colour, as `{ size: quantity }`. */
async function stockOf(shoeId: string) {
  const rows = await db
    .select({ size: shoeInventory.size, quantity: shoeInventory.quantity })
    .from(shoeInventory)
    .where(eq(shoeInventory.shoeId, shoeId));
  return Object.fromEntries(rows.map((r) => [r.size, r.quantity]));
}

async function coloursOf(modelId: string) {
  return db.select().from(shoes).where(eq(shoes.modelId, modelId));
}

/** What the arrivage recorded as received, as `{ size: quantity }` per colour. */
async function receivedIn(arrivalId: string) {
  const rows = await db
    .select({
      shoeId: shoeInventory.shoeId,
      size: shoeInventory.size,
      quantity: arrivalItems.quantity,
    })
    .from(arrivalItems)
    .innerJoin(shoeInventory, eq(arrivalItems.shoeInventoryId, shoeInventory.id))
    .where(eq(arrivalItems.arrivalId, arrivalId));
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) (out[r.shoeId] ??= {})[r.size] = r.quantity;
  return out;
}

/** The Movement Ledger rows of one arrivage, as `{ size: delta }` per reason. */
async function ledgerOf(arrivalId: string) {
  const rows = await db
    .select({
      reason: stockMovements.reason,
      size: shoeInventory.size,
      delta: stockMovements.delta,
    })
    .from(stockMovements)
    .innerJoin(shoeInventory, eq(stockMovements.shoeInventoryId, shoeInventory.id))
    .where(eq(stockMovements.arrivalId, arrivalId));
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) (out[r.reason] ??= {})[r.size] = r.delta;
  return out;
}

/** Sizes the gallery was told came back into stock. */
async function restockFlags() {
  const rows = await db
    .select({ size: shoeInventory.size, direction: ImageNotifierTable.direction })
    .from(ImageNotifierTable)
    .innerJoin(shoeInventory, eq(ImageNotifierTable.shoeInventoryId, shoeInventory.id));
  return rows.filter((r) => r.direction === "restock").map((r) => r.size);
}

describe("saveArrival: a new colour", () => {
  it("creates one Product with one size row per size, each with its own quantity", async () => {
    const model = await seedModel("Air Force 1");

    const result = await save(
      [
        {
          mode: "new",
          modelId: model.id,
          color: "Red",
          sizes: [
            { size: "43", quantity: 2 },
            { size: "44", quantity: 4 },
          ],
        },
      ],
      { reference: "AR-1", note: "supplier X" },
    );

    const colours = await coloursOf(model.id);
    expect(colours).toHaveLength(1);
    expect(colours[0].color).toBe("Red");
    expect(await stockOf(colours[0].id)).toEqual({ "43": 2, "44": 4 });

    expect(result.created).toEqual([
      { shoeId: colours[0].id, modelName: "Air Force 1", color: "Red" },
    ]);
    expect(await receivedIn(result.arrivalId)).toEqual({
      [colours[0].id]: { "43": 2, "44": 4 },
    });
    const [arrival] = await db.select().from(arrivals);
    expect(arrival).toMatchObject({ id: result.arrivalId, reference: "AR-1", note: "supplier X" });
    // Sizes the arrivage created have their origin in the ledger too, and a
    // size nobody has seen before is not a restock.
    expect(await ledgerOf(result.arrivalId)).toEqual({ arrival: { "43": 2, "44": 4 } });
    expect(await restockFlags()).toEqual([]);
  });
});

describe("saveArrival: the duplicate guard", () => {
  it("makes one Product of the same new colour named on two lines, summing each size", async () => {
    const model = await seedModel("Air Force 1");

    const result = await save([
      {
        mode: "new",
        modelId: model.id,
        color: "Red",
        sizes: [
          { size: "43", quantity: 2 },
          { size: "44", quantity: 1 },
        ],
      },
      {
        mode: "new",
        modelId: model.id,
        color: "  red ",
        sizes: [
          { size: "44", quantity: 4 },
          { size: "45", quantity: 1 },
        ],
      },
    ]);

    const colours = await coloursOf(model.id);
    expect(colours).toHaveLength(1);
    expect(await stockOf(colours[0].id)).toEqual({ "43": 2, "44": 5, "45": 1 });
    expect(result.created).toEqual([
      { shoeId: colours[0].id, modelName: "Air Force 1", color: "Red" },
    ]);
    expect(await receivedIn(result.arrivalId)).toEqual({
      [colours[0].id]: { "43": 2, "44": 5, "45": 1 },
    });
  });

  it("keeps the same colour name on two different models apart", async () => {
    const af1 = await seedModel("Air Force 1");
    const dunk = await seedModel("Dunk Low");

    await save([
      { mode: "new", modelId: af1.id, color: "Red", sizes: [{ size: "43", quantity: 1 }] },
      { mode: "new", modelId: dunk.id, color: "Red", sizes: [{ size: "43", quantity: 1 }] },
    ]);

    expect(await coloursOf(af1.id)).toHaveLength(1);
    expect(await coloursOf(dunk.id)).toHaveLength(1);
  });
});

describe("saveArrival: a colour that already exists", () => {
  it("adds to the existing sizes and creates the ones it does not have", async () => {
    const model = await seedModel("Air Force 1");
    const white = await seedColour(model.id, "White", { "42": 3 });

    const result = await save([
      {
        mode: "existing",
        shoeId: white.id,
        sizes: [
          { size: "42", quantity: 2 },
          { size: "43", quantity: 1 },
        ],
      },
    ]);

    expect(await stockOf(white.id)).toEqual({ "42": 5, "43": 1 });
    expect(result.created).toEqual([]);
    expect(await receivedIn(result.arrivalId)).toEqual({
      [white.id]: { "42": 2, "43": 1 },
    });
  });

  it("resolves a 'new' colour that matches one by case and whitespace to that Product", async () => {
    const model = await seedModel("Air Force 1");
    const existing = await seedColour(model.id, "Triple Black", { "42": 1, "43": 0 });

    const result = await save([
      {
        mode: "new",
        modelId: model.id,
        color: " triple   BLACK ",
        sizes: [
          { size: "42", quantity: 2 },
          { size: "43", quantity: 1 },
        ],
      },
    ]);

    const colours = await coloursOf(model.id);
    expect(colours).toHaveLength(1);
    expect(colours[0].color).toBe("Triple Black");
    expect(await stockOf(existing.id)).toEqual({ "42": 3, "43": 1 });
    expect(result.created).toEqual([]);
    // It went in as an arrival Stock Movement, not as a bare insert.
    expect(await ledgerOf(result.arrivalId)).toEqual({ arrival: { "42": 2, "43": 1 } });
    expect(await restockFlags()).toEqual(["43"]);
  });

  it("sums a 'new' line and an 'existing' line that land on the same Product", async () => {
    const model = await seedModel("Air Force 1");
    const white = await seedColour(model.id, "White", { "42": 1 });

    const result = await save([
      { mode: "existing", shoeId: white.id, sizes: [{ size: "42", quantity: 2 }] },
      { mode: "new", modelId: model.id, color: "white", sizes: [{ size: "42", quantity: 3 }] },
    ]);

    expect(await stockOf(white.id)).toEqual({ "42": 6 });
    expect(await receivedIn(result.arrivalId)).toEqual({ [white.id]: { "42": 5 } });
  });
});

async function archivedFlags(modelId: string) {
  const [model] = await db.select().from(shoeModels).where(eq(shoeModels.id, modelId));
  const colours = await coloursOf(modelId);
  return {
    model: model.archived,
    colours: Object.fromEntries(colours.map((c) => [c.color, c.archived])),
  };
}

describe("saveArrival: archived colours and models", () => {
  it("unarchives an archived colour it restocks, and leaves its other colours alone", async () => {
    const model = await seedModel("Air Force 1");
    const red = await seedColour(model.id, "Red", { "42": 0 }, { archived: true });
    await seedColour(model.id, "Blue", {}, { archived: true });

    await save([{ mode: "existing", shoeId: red.id, sizes: [{ size: "42", quantity: 1 }] }]);

    expect(await archivedFlags(model.id)).toEqual({
      model: false,
      colours: { Red: false, Blue: true },
    });
  });

  it("unarchives the model too when the colour's model is archived", async () => {
    const model = await seedModel("Air Force 1", { archived: true });
    const red = await seedColour(model.id, "Red", {}, { archived: true });

    await save([{ mode: "existing", shoeId: red.id, sizes: [{ size: "42", quantity: 1 }] }]);

    expect(await archivedFlags(model.id)).toEqual({ model: false, colours: { Red: false } });
  });

  it("restocks the archived colour rather than creating a second one of the same name", async () => {
    const model = await seedModel("Air Force 1");
    const red = await seedColour(model.id, "Red", { "42": 1 }, { archived: true });

    const result = await save([
      { mode: "new", modelId: model.id, color: "red", sizes: [{ size: "42", quantity: 2 }] },
    ]);

    expect(result.created).toEqual([]);
    expect(await stockOf(red.id)).toEqual({ "42": 3 });
    expect(await archivedFlags(model.id)).toEqual({ model: false, colours: { Red: false } });
  });

  it("unarchives an archived model that receives a new colour", async () => {
    const model = await seedModel("Air Force 1", { archived: true });

    await save([
      { mode: "new", modelId: model.id, color: "Red", sizes: [{ size: "42", quantity: 1 }] },
    ]);

    expect(await archivedFlags(model.id)).toEqual({ model: false, colours: { Red: false } });
  });

  it("unarchives nothing when the transaction it runs in fails", async () => {
    const model = await seedModel("Air Force 1", { archived: true });
    const red = await seedColour(model.id, "Red", { "42": 0 }, { archived: true });

    await expect(
      db.transaction(async (tx) => {
        await saveArrival(
          { lines: [{ mode: "existing", shoeId: red.id, sizes: [{ size: "42", quantity: 1 }] }] },
          tx as unknown as Executor,
        );
        throw new Error("the connection dropped");
      }),
    ).rejects.toThrow("the connection dropped");

    expect(await archivedFlags(model.id)).toEqual({ model: true, colours: { Red: true } });
    expect(await stockOf(red.id)).toEqual({ "42": 0 });
    expect(await db.select().from(arrivals)).toEqual([]);
  });
});

describe("saveArrival: what an arrivage does not touch", () => {
  it("leaves the model's price exactly as it was, for new and existing colours alike", async () => {
    const model = await seedModel("Air Force 1", { basePrice: 4500, compareAtPrice: 5200 });
    const white = await seedColour(model.id, "White", { "42": 1 });

    await save([
      { mode: "existing", shoeId: white.id, sizes: [{ size: "42", quantity: 1 }] },
      // The old payload carried prices on a new line and the route wrote them
      // onto the model. A stale client still sending them must change nothing.
      {
        mode: "new",
        modelId: model.id,
        color: "Red",
        sizes: [{ size: "42", quantity: 1 }],
        basePrice: 0,
        compareAtPrice: null,
      },
    ]);

    const [after] = await db.select().from(shoeModels).where(eq(shoeModels.id, model.id));
    expect(after).toMatchObject({ basePrice: 4500, compareAtPrice: 5200 });
  });
});

describe("saveArrival: the gallery", () => {
  it("flags a restock when a size at Physical Quantity 0 receives pairs", async () => {
    const model = await seedModel("Air Force 1");
    const white = await seedColour(model.id, "White", { "42": 0, "43": 2 });

    await save([
      {
        mode: "existing",
        shoeId: white.id,
        sizes: [
          { size: "42", quantity: 3 },
          { size: "43", quantity: 1 },
        ],
      },
    ]);

    expect(await restockFlags()).toEqual(["42"]);
    expect(await db.select().from(ImageNotifierTable)).toHaveLength(1);
  });
});

describe("saveArrival: a payload it refuses", () => {
  async function expectRefused(lines: unknown, message: RegExp) {
    const attempt = save(lines);
    await expect(attempt).rejects.toBeInstanceOf(ArrivalError);
    await expect(attempt).rejects.toThrow(message);
    // Refused means refused whole: no arrivage, no colour, no stock.
    expect(await db.select().from(arrivals)).toEqual([]);
  }

  it("refuses an arrivage with no lines", async () => {
    await expectRefused([], /No lines/);
    await expectRefused(undefined, /No lines/);
  });

  it("refuses a line with no sizes", async () => {
    const model = await seedModel("Air Force 1");
    await expectRefused(
      [{ mode: "new", modelId: model.id, color: "Red", sizes: [] }],
      /at least one size/,
    );
    expect(await coloursOf(model.id)).toEqual([]);
  });

  it("refuses a size whose quantity is not a whole number of 1 or more", async () => {
    const model = await seedModel("Air Force 1");
    const white = await seedColour(model.id, "White", { "42": 1 });

    for (const quantity of [0, -1, 1.5, "2", null]) {
      await expectRefused(
        [
          { mode: "existing", shoeId: white.id, sizes: [{ size: "42", quantity: 2 }] },
          { mode: "new", modelId: model.id, color: "Red", sizes: [{ size: "43", quantity }] },
        ],
        /quantity of 1 or more/,
      );
    }
    expect(await stockOf(white.id)).toEqual({ "42": 1 });
  });

  it("refuses a new colour with no name", async () => {
    const model = await seedModel("Air Force 1");
    await expectRefused(
      [{ mode: "new", modelId: model.id, color: "   ", sizes: [{ size: "42", quantity: 1 }] }],
      /model and color/,
    );
  });

  it("refuses a shoe id where a model id belongs, naming it", async () => {
    await expectRefused(
      [{ mode: "new", modelId: "71f4c8482f5", color: "Red", sizes: [{ size: "42", quantity: 1 }] }],
      /Not a valid model id: 71f4c8482f5/,
    );
  });

  it("refuses a model that does not exist, naming it", async () => {
    const ghost = "229780d7-fe62-45f0-b104-295bab148621";
    await expectRefused(
      [{ mode: "new", modelId: ghost, color: "Red", sizes: [{ size: "42", quantity: 1 }] }],
      new RegExp(`Unknown model: ${ghost}`),
    );
  });

  it("ignores a reference or note that is not text rather than failing on it", async () => {
    const model = await seedModel("Air Force 1");

    await saveArrival(
      {
        reference: 42,
        note: { supplier: "X" },
        lines: [
          { mode: "new", modelId: model.id, color: "Red", sizes: [{ size: "42", quantity: 1 }] },
        ],
      },
      db as unknown as Executor,
    );

    const [arrival] = await db.select().from(arrivals);
    expect(arrival).toMatchObject({ reference: null, note: null });
  });

  it("refuses a colour that no longer exists, naming it", async () => {
    await expectRefused(
      [{ mode: "existing", shoeId: "gone1234567", sizes: [{ size: "42", quantity: 1 }] }],
      /Unknown shoe: gone1234567/,
    );
  });
});
