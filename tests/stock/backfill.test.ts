import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  LendedShoes,
  arrivalItems,
  arrivals,
  borrower,
  orderItems,
  ordersTable,
  shoeInventory,
  shoeModels,
  shoes,
  stautsGroupsTable,
  stockMovements,
  storeSales,
} from "@/lib/schema";
import {
  backfillStockMovements,
  reconstructMovements,
  type BackfillSources,
} from "@/lib/stock/backfill";
import { applyMovement } from "@/lib/stock/movement";
import {
  CANCELED_STATUS_ID,
  DELIVERED_STATUS_ID,
  READY_TO_SHIP_STATUS_ID,
  RETURNED_STATUS_ID,
} from "@/lib/orders/status";
import { createTestDb, type TestDb } from "../testDb";
import type { Executor } from "@/lib/db";

const NOTHING: BackfillSources = {
  live: [],
  arrivalItems: [],
  orders: [],
  orderItems: [],
  echangeReturns: [],
  storeSales: [],
  lended: [],
};

function order(
  id: string,
  extra: Partial<BackfillSources["orders"][number]> = {},
): BackfillSources["orders"][number] {
  return {
    id,
    createdAt: "2026-03-01",
    type: 1,
    statusId: DELIVERED_STATUS_ID,
    borrowerId: null,
    echangeResolvedAt: null,
    ...extra,
  };
}

/** The fields a reader of the history would notice, without the generated ids. */
function told(rows: ReturnType<typeof reconstructMovements>) {
  return rows.map((r) => ({
    reason: r.reason,
    size: r.shoeInventoryId,
    delta: r.delta,
    lendedDelta: r.lendedDelta,
    borrowerId: r.borrowerId,
    orderId: r.orderId,
    at: r.occurredAt.toISOString(),
  }));
}

describe("reconstructMovements", () => {
  it("turns an arrivage into one event, at the minute it was recorded", () => {
    const arrivedAt = new Date("2026-02-10T09:30:00Z");
    const rows = reconstructMovements({
      ...NOTHING,
      arrivalItems: [
        { arrivalId: "a1", inventoryId: "s38", quantity: 4, arrivedAt },
        { arrivalId: "a1", inventoryId: "s39", quantity: 2, arrivedAt },
      ],
    });

    expect(rows).toMatchObject([
      { reason: "arrival", shoeInventoryId: "s38", delta: 4, requested: 4, arrivalId: "a1", occurredAt: arrivedAt, reconstructed: true },
      { reason: "arrival", shoeInventoryId: "s39", delta: 2, arrivalId: "a1", occurredAt: arrivedAt },
    ]);
    expect(rows[0].groupId).toBe(rows[1].groupId);
  });

  it("places an order's sale at the end of the shop day it was placed on", () => {
    const rows = reconstructMovements({
      ...NOTHING,
      orders: [order("DHD-1", { createdAt: "2026-03-01" })],
      orderItems: [{ id: "i1", orderId: "DHD-1", inventoryId: "s38", quantity: 2 }],
    });

    expect(told(rows)).toEqual([
      {
        reason: "sale",
        size: "s38",
        delta: -2,
        lendedDelta: 0,
        borrowerId: null,
        orderId: "DHD-1",
        // 23:59:59 in Algiers, UTC+1.
        at: "2026-03-01T22:59:59.000Z",
      },
    ]);
  });

  it("invents no reversal for an order that came back: the past never dated it", () => {
    const rows = reconstructMovements({
      ...NOTHING,
      orders: [
        order("DHD-1", { statusId: RETURNED_STATUS_ID }),
        order("DHD-2", { statusId: CANCELED_STATUS_ID }),
      ],
      orderItems: [
        { id: "i1", orderId: "DHD-1", inventoryId: "s38", quantity: 1 },
        { id: "i2", orderId: "DHD-2", inventoryId: "s38", quantity: 1 },
      ],
    });

    expect(rows.map((r) => r.reason)).toEqual(["sale", "sale"]);
  });

  it("turns a store sale into a sale of one pair with no order", () => {
    const soldAt = new Date("2026-03-02T15:00:00Z");
    const rows = reconstructMovements({
      ...NOTHING,
      storeSales: [{ inventoryId: "s38", soldAt }],
    });

    expect(rows).toMatchObject([
      { reason: "sale", delta: -1, orderId: null, occurredAt: soldAt },
    ]);
  });

  describe("lended_shoes", () => {
    it("reads what no order explains as a lend or a bring-back", () => {
      const rows = reconstructMovements({
        ...NOTHING,
        lended: [
          { inventoryId: "s38", borrowerId: "b1", quantity: 3, createdAt: "2026-03-01" },
          { inventoryId: "s38", borrowerId: "b1", quantity: -1, createdAt: "2026-03-04" },
        ],
      });

      expect(told(rows)).toEqual([
        { reason: "lend", size: "s38", delta: 0, lendedDelta: 3, borrowerId: "b1", orderId: null, at: "2026-03-01T22:59:59.000Z" },
        { reason: "return", size: "s38", delta: 0, lendedDelta: -1, borrowerId: "b1", orderId: null, at: "2026-03-04T22:59:59.000Z" },
      ]);
      expect(rows[1].requested).toBe(1);
    });

    it("gathers the sizes lent to one Borrower on one day into one event", () => {
      const rows = reconstructMovements({
        ...NOTHING,
        lended: [
          { inventoryId: "s38", borrowerId: "b1", quantity: 1, createdAt: "2026-03-01" },
          { inventoryId: "s39", borrowerId: "b1", quantity: 2, createdAt: "2026-03-01" },
          { inventoryId: "s38", borrowerId: "b2", quantity: 1, createdAt: "2026-03-01" },
        ],
      });

      expect(rows[0].groupId).toBe(rows[1].groupId);
      expect(rows[2].groupId).not.toBe(rows[0].groupId);
    });

    it("does not read the row a Borrower's sale wrote as a bring-back", () => {
      const rows = reconstructMovements({
        ...NOTHING,
        orders: [order("DHD-1", { borrowerId: "b1", createdAt: "2026-03-02" })],
        orderItems: [{ id: "i1", orderId: "DHD-1", inventoryId: "s38", quantity: 1 }],
        lended: [
          { inventoryId: "s38", borrowerId: "b1", quantity: 2, createdAt: "2026-03-01" },
          { inventoryId: "s38", borrowerId: "b1", quantity: -1, createdAt: "2026-03-02" },
        ],
      });

      expect(told(rows).map((r) => [r.reason, r.delta, r.lendedDelta])).toEqual([
        ["borrower-sale", -1, -1],
        ["lend", 0, 2],
      ]);
    });

    it("keeps a real bring-back on the day of a Borrower's sale of the same size", () => {
      const rows = reconstructMovements({
        ...NOTHING,
        orders: [order("DHD-1", { borrowerId: "b1", createdAt: "2026-03-02" })],
        orderItems: [{ id: "i1", orderId: "DHD-1", inventoryId: "s38", quantity: 1 }],
        lended: [
          { inventoryId: "s38", borrowerId: "b1", quantity: -1, createdAt: "2026-03-05" },
          { inventoryId: "s38", borrowerId: "b1", quantity: -1, createdAt: "2026-03-02" },
        ],
      });

      // The row dated like the order is the sale's; the other one stays.
      expect(told(rows).filter((r) => r.reason === "return")).toMatchObject([
        { at: "2026-03-05T22:59:59.000Z" },
      ]);
    });

    it("leaves the lend that came before a returned Borrower order where it was", () => {
      const rows = reconstructMovements({
        ...NOTHING,
        orders: [order("DHD-1", { borrowerId: "b1", statusId: RETURNED_STATUS_ID, createdAt: "2026-03-01" })],
        orderItems: [{ id: "i1", orderId: "DHD-1", inventoryId: "s38", quantity: 1 }],
        lended: [
          { inventoryId: "s38", borrowerId: "b1", quantity: 1, createdAt: "2026-02-01" },
          { inventoryId: "s38", borrowerId: "b1", quantity: -1, createdAt: "2026-03-01" },
          // The retour giving the pair back — same size and quantity as the lend.
          { inventoryId: "s38", borrowerId: "b1", quantity: 1, createdAt: "2026-03-09" },
        ],
      });

      expect(told(rows).map((r) => [r.reason, r.at.slice(0, 10)])).toEqual([
        ["borrower-sale", "2026-03-01"],
        ["lend", "2026-02-01"],
      ]);
    });

    it("does not read the pairs a returned Borrower order gave back as a fresh lend", () => {
      const rows = reconstructMovements({
        ...NOTHING,
        orders: [order("DHD-1", { borrowerId: "b1", statusId: RETURNED_STATUS_ID })],
        orderItems: [{ id: "i1", orderId: "DHD-1", inventoryId: "s38", quantity: 1 }],
        lended: [
          { inventoryId: "s38", borrowerId: "b1", quantity: -1, createdAt: "2026-03-01" },
          { inventoryId: "s38", borrowerId: "b1", quantity: 1, createdAt: "2026-03-09" },
        ],
      });

      expect(rows.map((r) => r.reason)).toEqual(["borrower-sale"]);
    });
  });

  describe("an Échange the resolver decided", () => {
    const resolvedAt = new Date("2026-10-05T08:00:00Z");
    const sources: BackfillSources = {
      ...NOTHING,
      orders: [
        order("ORIG", { borrowerId: "b1" }),
        order("ECH", { type: 2, echangeResolvedAt: resolvedAt, createdAt: "2026-10-01" }),
      ],
      orderItems: [
        { id: "orig-line", orderId: "ORIG", inventoryId: "s38", quantity: 2 },
        { id: "ech-line", orderId: "ECH", inventoryId: "s40", quantity: 1 },
      ],
      echangeReturns: [{ echangeId: "ECH", orderItemId: "orig-line", quantity: 1 }],
    };

    it("swapped: brings the Returned Pair back to whoever sold it, when it was decided", () => {
      const rows = reconstructMovements(sources);

      expect(told(rows).filter((r) => r.reason === "echange-return")).toEqual([
        {
          reason: "echange-return",
          size: "s38",
          delta: 1,
          lendedDelta: 1,
          borrowerId: "b1",
          orderId: "ECH",
          at: resolvedAt.toISOString(),
        },
      ]);
    });

    it("refused: brings the Outgoing Pair back instead", () => {
      const rows = reconstructMovements({
        ...sources,
        orders: [
          sources.orders[0],
          { ...sources.orders[1], statusId: RETURNED_STATUS_ID },
        ],
      });

      expect(told(rows).filter((r) => r.orderId === "ECH")).toMatchObject([
        { reason: "sale", size: "s40", delta: -1 },
        { reason: "retour", size: "s40", delta: 1, at: resolvedAt.toISOString() },
      ]);
    });

    it("moves nothing for a Legacy Échange, which has no link", () => {
      const rows = reconstructMovements({ ...sources, echangeReturns: [] });

      expect(rows.map((r) => r.reason)).toEqual(["borrower-sale", "sale"]);
    });
  });

  describe("what the ledger recorded live", () => {
    const liveRow = (extra: Partial<BackfillSources["live"][number]>) => ({
      reason: "sale",
      shoeInventoryId: "s38",
      borrowerId: null,
      orderId: null,
      arrivalId: null,
      lendedDelta: 0,
      occurredAt: new Date("2026-10-08T12:00:00Z"),
      ...extra,
    });

    it("is not reconstructed again: orders, arrivages, later store sales, and their Holdings rows", () => {
      const rows = reconstructMovements({
        ...NOTHING,
        live: [
          liveRow({ reason: "sale", orderId: "DHD-LIVE" }),
          liveRow({ reason: "arrival", arrivalId: "a-live" }),
          liveRow({ reason: "lend", borrowerId: "b1", lendedDelta: 2 }),
        ],
        orders: [order("DHD-LIVE", { createdAt: "2026-10-08" })],
        orderItems: [{ id: "i1", orderId: "DHD-LIVE", inventoryId: "s38", quantity: 1 }],
        arrivalItems: [
          { arrivalId: "a-live", inventoryId: "s38", quantity: 5, arrivedAt: new Date("2026-10-08T12:00:00Z") },
        ],
        storeSales: [
          { inventoryId: "s38", soldAt: new Date("2026-10-08T11:00:00Z") },
          { inventoryId: "s38", soldAt: new Date("2026-10-08T13:00:00Z") },
        ],
        lended: [{ inventoryId: "s38", borrowerId: "b1", quantity: 2, createdAt: "2026-10-08" }],
      });

      // Only the store sale from before the ledger's first row is left to tell.
      expect(told(rows)).toMatchObject([{ reason: "sale", orderId: null, at: "2026-10-08T11:00:00.000Z" }]);
    });

    it("recognises the first live store sale, whose own row is a moment older than the ledger's", () => {
      // store_sales stamps the transaction's start; the ledger stamps the
      // movement inside it. The sale that started the ledger is therefore
      // "before" the ledger's first row by a few milliseconds.
      const rows = reconstructMovements({
        ...NOTHING,
        live: [liveRow({ reason: "sale", occurredAt: new Date("2026-10-08T12:00:00.250Z") })],
        storeSales: [
          { inventoryId: "s38", soldAt: new Date("2026-10-07T09:00:00Z") },
          { inventoryId: "s38", soldAt: new Date("2026-10-08T12:00:00.100Z") },
        ],
      });

      expect(told(rows)).toMatchObject([{ reason: "sale", at: "2026-10-07T09:00:00.000Z" }]);
    });

    it("does not explain away a past order's Holdings row when its retour was recorded live", () => {
      const rows = reconstructMovements({
        ...NOTHING,
        live: [liveRow({ reason: "retour", orderId: "DHD-1", borrowerId: "b1", lendedDelta: 1 })],
        orders: [order("DHD-1", { borrowerId: "b1", statusId: RETURNED_STATUS_ID })],
        orderItems: [{ id: "i1", orderId: "DHD-1", inventoryId: "s38", quantity: 1 }],
        lended: [
          { inventoryId: "s38", borrowerId: "b1", quantity: -1, createdAt: "2026-03-01" },
          // The live retour's own row…
          { inventoryId: "s38", borrowerId: "b1", quantity: 1, createdAt: "2026-10-08" },
          // …and an unrelated lend that must survive as one.
          { inventoryId: "s38", borrowerId: "b1", quantity: 1, createdAt: "2026-02-01" },
        ],
      });

      expect(told(rows).map((r) => [r.reason, r.at.slice(0, 10)])).toEqual([
        ["borrower-sale", "2026-03-01"],
        ["lend", "2026-02-01"],
      ]);
    });
  });
});

describe("backfillStockMovements", () => {
  let db: TestDb;
  const exec = () => db as unknown as Executor;

  async function seedPast() {
    const [model] = await db.insert(shoeModels).values({ modelName: "Air Force 1" }).returning();
    const [shoe] = await db
      .insert(shoes)
      .values({ id: "shoe-1", modelId: model.id, color: "White" })
      .returning();
    const [size] = await db
      .insert(shoeInventory)
      .values({ shoeId: shoe.id, size: "42", quantity: 5 })
      .returning();
    const [yacine] = await db.insert(borrower).values({ name: "Yacine" }).returning();
    await db.insert(stautsGroupsTable).values([
      { id: READY_TO_SHIP_STATUS_ID, name: "prete a expedier" },
      { id: DELIVERED_STATUS_ID, name: "Livre" },
    ]);

    const [arrival] = await db
      .insert(arrivals)
      .values({ createdAt: new Date("2026-02-10T09:30:00Z") })
      .returning();
    await db.insert(arrivalItems).values({ arrivalId: arrival.id, shoeInventoryId: size.id, quantity: 8 });

    await db.insert(ordersTable).values({
      id: "DHD-1",
      nom_client: "Amine",
      telephone: "0555000000",
      adresse: "-",
      commune: "Alger",
      code_wilaya: "16",
      montant: "0",
      type: 1,
      stop_desk: 0,
      statusId: DELIVERED_STATUS_ID,
      createdAt: "2026-03-01",
    });
    await db.insert(orderItems).values({ orderId: "DHD-1", shoeInventoryId: size.id, quantity: 2 });
    await db.insert(storeSales).values({ shoeInventoryId: size.id, createdAt: new Date("2026-03-02T15:00:00Z") });
    // Written straight to the table: this is the past, from before the ledger.
    await db.insert(LendedShoes).values({
      shoeInventoryId: size.id,
      borrowerId: yacine.id,
      quantity: 1,
      createdAt: "2026-03-03",
    });

    return { size, yacine };
  }

  const ledger = () =>
    db
      .select({
        reason: stockMovements.reason,
        delta: stockMovements.delta,
        lendedDelta: stockMovements.lendedDelta,
        reconstructed: stockMovements.reconstructed,
        quantityAfter: stockMovements.quantityAfter,
      })
      .from(stockMovements)
      .orderBy(stockMovements.occurredAt);

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("reports what it would write on a dry run, and writes nothing", async () => {
    await seedPast();

    const result = await backfillStockMovements({ apply: false }, exec());

    expect(result).toEqual({
      counts: { arrival: 1, sale: 2, lend: 1 },
      total: 4,
      replaced: 0,
      applied: false,
    });
    expect(await ledger()).toEqual([]);
  });

  it("writes the past as Reconstructed Movements, with no stock level", async () => {
    await seedPast();

    await backfillStockMovements({ apply: true }, exec());

    expect(await ledger()).toEqual([
      { reason: "arrival", delta: 8, lendedDelta: 0, reconstructed: true, quantityAfter: null },
      { reason: "sale", delta: -2, lendedDelta: 0, reconstructed: true, quantityAfter: null },
      { reason: "sale", delta: -1, lendedDelta: 0, reconstructed: true, quantityAfter: null },
      { reason: "lend", delta: 0, lendedDelta: 1, reconstructed: true, quantityAfter: null },
    ]);
  });

  it("leaves Physical Quantity and Holdings exactly as they were", async () => {
    const { size } = await seedPast();

    await backfillStockMovements({ apply: true }, exec());

    const [row] = await db.select().from(shoeInventory).where(eq(shoeInventory.id, size.id));
    expect(row.quantity).toBe(5);
    expect(await db.select().from(LendedShoes)).toHaveLength(1);
  });

  it("converges when run again, and never touches a live row", async () => {
    const { size, yacine } = await seedPast();
    await backfillStockMovements({ apply: true }, exec());

    // The ledger goes live: a sale and a lend recorded as they happen.
    await applyMovement({ reason: "sale", items: [{ inventoryId: size.id, quantity: 1 }] }, exec());
    await applyMovement(
      { reason: "lend", items: [{ inventoryId: size.id, quantity: 2 }], borrowerId: yacine.id },
      exec(),
    );

    const before = await ledger();
    const second = await backfillStockMovements({ apply: true }, exec());

    expect(second).toMatchObject({ total: 4, replaced: 4, applied: true });
    expect(await ledger()).toEqual(before);
    expect(before.filter((r) => !r.reconstructed)).toEqual([
      { reason: "sale", delta: -1, lendedDelta: 0, reconstructed: false, quantityAfter: 4 },
      { reason: "lend", delta: 0, lendedDelta: 2, reconstructed: false, quantityAfter: 4 },
    ]);
  });
});
