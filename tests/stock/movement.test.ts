import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  ImageNotifierTable,
  LendedShoes,
  borrower,
  shoeInventory,
  shoeModels,
  shoes,
} from "@/lib/schema";
import { applyMovement, type MovementInput } from "@/lib/stock/movement";
import { createTestDb, type TestDb } from "../testDb";
import type { Executor } from "@/lib/db";

let db: TestDb;

async function seedVariant(quantity: number) {
  const [model] = await db.insert(shoeModels).values({ modelName: "Air Force 1" }).returning();
  const [shoe] = await db
    .insert(shoes)
    .values({ id: `shoe-${crypto.randomUUID()}`, modelId: model.id, color: "White" })
    .returning();
  const [inv] = await db
    .insert(shoeInventory)
    .values({ shoeId: shoe.id, size: "42", quantity })
    .returning();
  return inv;
}

async function seedBorrower() {
  const [b] = await db.insert(borrower).values({ name: "Yacine" }).returning();
  return b;
}

async function move(input: MovementInput) {
  return applyMovement(input, db as unknown as Executor);
}

async function notifierDirection(inventoryId: string) {
  const rows = await db
    .select({ direction: ImageNotifierTable.direction })
    .from(ImageNotifierTable)
    .where(eq(ImageNotifierTable.shoeInventoryId, inventoryId));
  return rows.map((r) => r.direction);
}

async function heldByBorrower(borrowerId: string, inventoryId: string) {
  const rows = await db
    .select({ quantity: LendedShoes.quantity })
    .from(LendedShoes)
    .where(and(eq(LendedShoes.borrowerId, borrowerId), eq(LendedShoes.shoeInventoryId, inventoryId)));
  return rows.reduce((sum, r) => sum + r.quantity, 0);
}

beforeEach(async () => {
  db = await createTestDb();
});

describe("applyMovement: sale", () => {
  it("decrements Physical Quantity and flags the gallery only when it reaches zero", async () => {
    const inv = await seedVariant(2);

    await move({ reason: "sale", items: [{ inventoryId: inv.id, quantity: 1 }] });
    let [row] = await db.select().from(shoeInventory).where(eq(shoeInventory.id, inv.id));
    expect(row.quantity).toBe(1);
    expect(await notifierDirection(inv.id)).toEqual([]);

    await move({ reason: "sale", items: [{ inventoryId: inv.id, quantity: 1 }] });
    [row] = await db.select().from(shoeInventory).where(eq(shoeInventory.id, inv.id));
    expect(row.quantity).toBe(0);
    expect(await notifierDirection(inv.id)).toEqual(["remove"]);
  });

  it("floors a decrement at zero instead of going negative", async () => {
    const inv = await seedVariant(1);

    await move({ reason: "sale", items: [{ inventoryId: inv.id, quantity: 5 }] });
    const [row] = await db.select().from(shoeInventory).where(eq(shoeInventory.id, inv.id));
    expect(row.quantity).toBe(0);
  });
});

describe("applyMovement: borrower-sale", () => {
  it("drops Physical Quantity and that borrower's Holdings together", async () => {
    const inv = await seedVariant(3);
    const b = await seedBorrower();
    await move({ reason: "lend", items: [{ inventoryId: inv.id, quantity: 3 }], borrowerId: b.id });

    await move({
      reason: "borrower-sale",
      items: [{ inventoryId: inv.id, quantity: 2 }],
      borrowerId: b.id,
    });

    const [row] = await db.select().from(shoeInventory).where(eq(shoeInventory.id, inv.id));
    expect(row.quantity).toBe(1);
    expect(await heldByBorrower(b.id, inv.id)).toBe(1);
  });
});

describe("applyMovement: lend and return never flag the gallery", () => {
  // This is the central regression this work turns on: lending or bringing
  // back stock must never touch Physical Quantity or the notifier queue,
  // because a Borrower is a Storage Location, not a sale.
  it("lending the last in-store pair leaves Physical Quantity untouched and queues no gallery flag", async () => {
    const inv = await seedVariant(1);
    const b = await seedBorrower();

    await move({ reason: "lend", items: [{ inventoryId: inv.id, quantity: 1 }], borrowerId: b.id });

    const [row] = await db.select().from(shoeInventory).where(eq(shoeInventory.id, inv.id));
    expect(row.quantity).toBe(1);
    expect(await notifierDirection(inv.id)).toEqual([]);
    expect(await heldByBorrower(b.id, inv.id)).toBe(1);
  });

  it("bringing pairs back leaves Physical Quantity untouched and queues no gallery flag", async () => {
    const inv = await seedVariant(1);
    const b = await seedBorrower();
    await move({ reason: "lend", items: [{ inventoryId: inv.id, quantity: 1 }], borrowerId: b.id });

    await move({ reason: "return", items: [{ inventoryId: inv.id, quantity: 1 }], borrowerId: b.id });

    const [row] = await db.select().from(shoeInventory).where(eq(shoeInventory.id, inv.id));
    expect(row.quantity).toBe(1);
    expect(await notifierDirection(inv.id)).toEqual([]);
    expect(await heldByBorrower(b.id, inv.id)).toBe(0);
  });
});

describe("applyMovement: cancel and retour", () => {
  it("restore exactly what a multi-unit sale removed", async () => {
    const inv = await seedVariant(5);
    await move({ reason: "sale", items: [{ inventoryId: inv.id, quantity: 3 }] });

    await move({ reason: "cancel", items: [{ inventoryId: inv.id, quantity: 3 }] });
    let [row] = await db.select().from(shoeInventory).where(eq(shoeInventory.id, inv.id));
    expect(row.quantity).toBe(5);

    await move({ reason: "sale", items: [{ inventoryId: inv.id, quantity: 3 }] });
    await move({ reason: "retour", items: [{ inventoryId: inv.id, quantity: 3 }] });
    [row] = await db.select().from(shoeInventory).where(eq(shoeInventory.id, inv.id));
    expect(row.quantity).toBe(5);
  });

  it("re-flag restock when a cancel brings a sold-out variant back above zero", async () => {
    const inv = await seedVariant(1);
    await move({ reason: "sale", items: [{ inventoryId: inv.id, quantity: 1 }] });
    expect(await notifierDirection(inv.id)).toEqual(["remove"]);

    await move({ reason: "cancel", items: [{ inventoryId: inv.id, quantity: 1 }] });
    expect(await notifierDirection(inv.id)).toEqual([]);
  });
});

describe("applyMovement: echange-return", () => {
  // The Returned Pair of an Échange coming back once the swap is confirmed.
  it("puts the Returned Pair back into Physical Quantity and re-flags a sold-out variant", async () => {
    const inv = await seedVariant(1);
    await move({ reason: "sale", items: [{ inventoryId: inv.id, quantity: 1 }] });
    expect(await notifierDirection(inv.id)).toEqual(["remove"]);

    await move({ reason: "echange-return", items: [{ inventoryId: inv.id, quantity: 1 }] });

    const [row] = await db.select().from(shoeInventory).where(eq(shoeInventory.id, inv.id));
    expect(row.quantity).toBe(1);
    expect(await notifierDirection(inv.id)).toEqual([]);
  });

  it("gives a borrower-placed Original Order's pair back to that Borrower's Holdings", async () => {
    const inv = await seedVariant(2);
    const b = await seedBorrower();
    await move({ reason: "lend", items: [{ inventoryId: inv.id, quantity: 2 }], borrowerId: b.id });
    await move({
      reason: "borrower-sale",
      items: [{ inventoryId: inv.id, quantity: 1 }],
      borrowerId: b.id,
    });

    await move({
      reason: "echange-return",
      items: [{ inventoryId: inv.id, quantity: 1 }],
      borrowerId: b.id,
    });

    const [row] = await db.select().from(shoeInventory).where(eq(shoeInventory.id, inv.id));
    expect(row.quantity).toBe(2);
    expect(await heldByBorrower(b.id, inv.id)).toBe(2);
  });
});

describe("applyMovement: correction", () => {
  it("a correction that dips to zero and back leaves nothing queued", async () => {
    const inv = await seedVariant(3);

    await move({ reason: "correction", items: [{ inventoryId: inv.id, newQuantity: 0 }] });
    expect(await notifierDirection(inv.id)).toEqual(["remove"]);

    await move({ reason: "correction", items: [{ inventoryId: inv.id, newQuantity: 3 }] });
    expect(await notifierDirection(inv.id)).toEqual([]);
  });

  it("an edit that doesn't cross zero queues nothing", async () => {
    const inv = await seedVariant(5);
    await move({ reason: "correction", items: [{ inventoryId: inv.id, newQuantity: 2 }] });
    expect(await notifierDirection(inv.id)).toEqual([]);
  });
});

describe("applyMovement: arrival", () => {
  it("increments Physical Quantity and flags restock only for variants that were at zero", async () => {
    const soldOut = await seedVariant(0);
    const inStock = await seedVariant(2);

    await move({
      reason: "arrival",
      items: [
        { inventoryId: soldOut.id, quantity: 4 },
        { inventoryId: inStock.id, quantity: 4 },
      ],
    });

    const [soldOutRow] = await db.select().from(shoeInventory).where(eq(shoeInventory.id, soldOut.id));
    const [inStockRow] = await db.select().from(shoeInventory).where(eq(shoeInventory.id, inStock.id));
    expect(soldOutRow.quantity).toBe(4);
    expect(inStockRow.quantity).toBe(6);
    expect(await notifierDirection(soldOut.id)).toEqual(["restock"]);
    expect(await notifierDirection(inStock.id)).toEqual([]);
  });
});
