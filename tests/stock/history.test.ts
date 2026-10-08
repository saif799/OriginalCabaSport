import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  arrivals,
  borrower,
  ordersTable,
  shoeInventory,
  shoeModels,
  shoes,
  stautsGroupsTable,
  stockMovements,
} from "@/lib/schema";
import { applyMovement, type MovementInput } from "@/lib/stock/movement";
import {
  getHistorySummary,
  getMovementHistory,
  isIsoDay,
  type HistoryFilters,
} from "@/lib/stock/history";
import { CANCELED_STATUS_ID, DELIVERED_STATUS_ID, RETURNED_STATUS_ID } from "@/lib/orders/status";
import { createTestDb, type TestDb } from "../testDb";
import type { Executor } from "@/lib/db";

let db: TestDb;

/** One colour variant with a row per size, all starting at `quantity`. */
async function seedShoe(color: string, sizes: string[], quantity = 10) {
  const [model] = await db.insert(shoeModels).values({ modelName: "Air Force 1" }).returning();
  const [shoe] = await db
    .insert(shoes)
    .values({ id: `shoe-${crypto.randomUUID()}`, modelId: model.id, color })
    .returning();
  const rows = await db
    .insert(shoeInventory)
    .values(sizes.map((size) => ({ shoeId: shoe.id, size, quantity })))
    .returning();
  const bySize = Object.fromEntries(rows.map((r) => [r.size, r.id]));
  return { shoeId: shoe.id, inv: (size: string) => bySize[size] as string };
}

async function seedBorrower(name = "Yacine") {
  const [b] = await db.insert(borrower).values({ name }).returning();
  return b;
}

async function seedOrder(
  id: string,
  statusId: string,
  extra: { type?: number; echangeResolvedAt?: Date } = {},
) {
  await db
    .insert(stautsGroupsTable)
    .values({ id: statusId, name: `status-${statusId.slice(0, 4)}` })
    .onConflictDoNothing();
  await db.insert(ordersTable).values({
    id,
    nom_client: "Amine",
    telephone: "0555000000",
    adresse: "-",
    commune: "Alger",
    code_wilaya: "16",
    montant: "0",
    type: extra.type ?? 1,
    stop_desk: 0,
    statusId,
    echangeResolvedAt: extra.echangeResolvedAt,
  });
}

function move(input: MovementInput) {
  return applyMovement(input, db as unknown as Executor);
}

function history(filters: HistoryFilters) {
  return getMovementHistory(filters, db as unknown as Executor);
}

function summary(filters: HistoryFilters) {
  return getHistorySummary(filters, db as unknown as Executor);
}

/** Moves every row of one movement to a fixed instant, so date filters have something to bite on. */
async function datedMove(input: MovementInput, at: string) {
  await move(input);
  const [last] = await db
    .select({ groupId: stockMovements.groupId })
    .from(stockMovements)
    .orderBy(stockMovements.occurredAt)
    .then((rows) => rows.slice(-1));
  await db
    .update(stockMovements)
    .set({ occurredAt: new Date(at) })
    .where(eq(stockMovements.groupId, last.groupId));
}

beforeEach(async () => {
  db = await createTestDb();
});

describe("getMovementHistory", () => {
  it("shows one event per movement per colour, its sizes gathered in size order", async () => {
    const white = await seedShoe("White", ["38", "39", "40.5"]);

    await move({
      reason: "arrival",
      items: [
        { inventoryId: white.inv("40.5"), quantity: 1 },
        { inventoryId: white.inv("38"), quantity: 2 },
        { inventoryId: white.inv("39"), quantity: 3 },
      ],
    });

    const { events, total } = await history({ shoeIds: [white.shoeId] });

    expect(total).toBe(1);
    expect(events).toMatchObject([
      {
        shoeId: white.shoeId,
        modelName: "Air Force 1",
        color: "White",
        reason: "arrival",
        family: "arrived",
        units: 6,
        sizes: [
          { size: "38", delta: 2, quantityAfter: 12 },
          { size: "39", delta: 3, quantityAfter: 13 },
          { size: "40.5", delta: 1, quantityAfter: 11 },
        ],
      },
    ]);
  });

  it("splits a movement that spans two colours into one event each, and keeps unselected colours out", async () => {
    const white = await seedShoe("White", ["38"]);
    const black = await seedShoe("Black", ["38"]);
    const red = await seedShoe("Red", ["38"]);

    await move({
      reason: "sale",
      items: [
        { inventoryId: white.inv("38"), quantity: 1 },
        { inventoryId: black.inv("38"), quantity: 2 },
        { inventoryId: red.inv("38"), quantity: 4 },
      ],
    });

    const { events, total } = await history({ shoeIds: [white.shoeId, black.shoeId] });

    expect(total).toBe(2);
    expect(events.map((e) => [e.color, e.units]).sort()).toEqual([
      ["Black", -2],
      ["White", -1],
    ]);
  });

  it("merges the selected colours into one timeline, newest first", async () => {
    const white = await seedShoe("White", ["38"]);
    const black = await seedShoe("Black", ["38"]);

    await datedMove({ reason: "sale", items: [{ inventoryId: white.inv("38"), quantity: 1 }] }, "2026-03-01T10:00:00Z");
    await datedMove({ reason: "sale", items: [{ inventoryId: black.inv("38"), quantity: 1 }] }, "2026-03-03T10:00:00Z");
    await datedMove({ reason: "arrival", items: [{ inventoryId: white.inv("38"), quantity: 5 }] }, "2026-03-02T10:00:00Z");

    const { events } = await history({ shoeIds: [white.shoeId, black.shoeId] });

    expect(events.map((e) => `${e.color} ${e.reason}`)).toEqual([
      "Black sale",
      "White arrival",
      "White sale",
    ]);
  });

  it("names the Borrower, and counts a lend by the pairs that changed hands", async () => {
    const white = await seedShoe("White", ["38"]);
    const yacine = await seedBorrower("Yacine");

    await move({ reason: "lend", items: [{ inventoryId: white.inv("38"), quantity: 3 }], borrowerId: yacine.id });
    await move({ reason: "return", items: [{ inventoryId: white.inv("38"), quantity: 1 }], borrowerId: yacine.id });

    const { events } = await history({ shoeIds: [white.shoeId] });

    expect(events).toMatchObject([
      { family: "brought-back", units: 1, borrower: { id: yacine.id, name: "Yacine" } },
      { family: "lent", units: 3, borrower: { id: yacine.id, name: "Yacine" } },
    ]);
  });

  it("carries the order with its current status, the arrivage, and a correction's note", async () => {
    const white = await seedShoe("White", ["38"]);
    await seedOrder("DHD-1", DELIVERED_STATUS_ID);
    const [arrival] = await db.insert(arrivals).values({ reference: "Lot 7" }).returning();

    await move({ reason: "arrival", items: [{ inventoryId: white.inv("38"), quantity: 2 }], arrivalId: arrival.id });
    await move({ reason: "sale", items: [{ inventoryId: white.inv("38"), quantity: 1 }], orderId: "DHD-1" });
    await move({ reason: "correction", items: [{ inventoryId: white.inv("38"), newQuantity: 9 }], note: "one was a display pair" });

    const { events } = await history({ shoeIds: [white.shoeId] });

    expect(events).toMatchObject([
      { family: "correction", units: -2, note: "one was a display pair", order: null, arrival: null },
      { family: "sold", order: { id: "DHD-1", statusId: DELIVERED_STATUS_ID } },
      { family: "arrived", arrival: { id: arrival.id, reference: "Lot 7" } },
    ]);
  });

  it("marks a sale that asked for more than the stock held", async () => {
    const white = await seedShoe("White", ["38"], 1);

    await move({ reason: "sale", items: [{ inventoryId: white.inv("38"), quantity: 3 }] });

    const { events } = await history({ shoeIds: [white.shoeId] });
    expect(events).toMatchObject([{ units: -1, oversold: true }]);
  });

  it("filters by Event Family", async () => {
    const white = await seedShoe("White", ["38"]);
    await move({ reason: "arrival", items: [{ inventoryId: white.inv("38"), quantity: 2 }] });
    await move({ reason: "sale", items: [{ inventoryId: white.inv("38"), quantity: 1 }] });
    await move({ reason: "retour", items: [{ inventoryId: white.inv("38"), quantity: 1 }] });

    const { events, total } = await history({
      shoeIds: [white.shoeId],
      families: ["sold", "came-back"],
    });

    expect(total).toBe(2);
    expect(events.map((e) => e.reason)).toEqual(["retour", "sale"]);
  });

  it("filters by size, showing only the sizes asked for", async () => {
    const white = await seedShoe("White", ["38", "39"]);
    await move({
      reason: "sale",
      items: [
        { inventoryId: white.inv("38"), quantity: 1 },
        { inventoryId: white.inv("39"), quantity: 2 },
      ],
    });
    await move({ reason: "sale", items: [{ inventoryId: white.inv("38"), quantity: 1 }] });

    const { events, total } = await history({ shoeIds: [white.shoeId], sizes: ["39"] });

    expect(total).toBe(1);
    expect(events).toMatchObject([{ units: -2, sizes: [{ size: "39" }] }]);
  });

  it("filters by Borrower", async () => {
    const white = await seedShoe("White", ["38"]);
    const yacine = await seedBorrower("Yacine");
    const karim = await seedBorrower("Karim");
    await move({ reason: "lend", items: [{ inventoryId: white.inv("38"), quantity: 1 }], borrowerId: yacine.id });
    await move({ reason: "lend", items: [{ inventoryId: white.inv("38"), quantity: 2 }], borrowerId: karim.id });
    await move({ reason: "sale", items: [{ inventoryId: white.inv("38"), quantity: 1 }] });

    const { events } = await history({ shoeIds: [white.shoeId], borrowerId: karim.id });

    expect(events).toMatchObject([{ family: "lent", units: 2 }]);
    expect(events).toHaveLength(1);
  });

  it("filters by shop-local day, inclusive at both ends", async () => {
    const white = await seedShoe("White", ["38"]);
    const sale = (at: string) =>
      datedMove({ reason: "sale", items: [{ inventoryId: white.inv("38"), quantity: 1 }] }, at);
    await sale("2026-03-01T12:00:00Z");
    // 23:30 UTC on the 2nd is already the 3rd in Algiers (UTC+1).
    await sale("2026-03-02T23:30:00Z");
    await sale("2026-03-04T12:00:00Z");

    const { events } = await history({
      shoeIds: [white.shoeId],
      from: "2026-03-03",
      to: "2026-03-04",
    });

    expect(events.map((e) => e.occurredAt.toISOString())).toEqual([
      "2026-03-04T12:00:00.000Z",
      "2026-03-02T23:30:00.000Z",
    ]);
  });

  it("ignores a day that is not on the calendar instead of failing the read", async () => {
    const white = await seedShoe("White", ["38"]);
    await move({ reason: "sale", items: [{ inventoryId: white.inv("38"), quantity: 1 }] });

    expect(isIsoDay("2026-02-31")).toBe(false);
    expect(isIsoDay("2026-02-28")).toBe(true);
    const { total } = await history({ shoeIds: [white.shoeId], from: "2026-02-31", to: "not-a-day" });
    expect(total).toBe(1);
  });

  it("pages fifty events at a time and still reports the full count", async () => {
    const white = await seedShoe("White", ["38"], 100);
    for (let i = 0; i < 52; i++) {
      await move({ reason: "sale", items: [{ inventoryId: white.inv("38"), quantity: 1 }] });
    }

    const first = await history({ shoeIds: [white.shoeId] });
    const second = await history({ shoeIds: [white.shoeId], page: 2 });

    expect(first.total).toBe(52);
    expect(first.events).toHaveLength(50);
    expect(second.events).toHaveLength(2);
  });

  it("returns nothing when no colour is selected", async () => {
    const white = await seedShoe("White", ["38"]);
    await move({ reason: "sale", items: [{ inventoryId: white.inv("38"), quantity: 1 }] });

    expect(await history({ shoeIds: [] })).toEqual({ events: [], total: 0 });
  });
});

describe("getHistorySummary", () => {
  it("adds up what arrived, sold and came back, beside the live stock and Holdings", async () => {
    const white = await seedShoe("White", ["38", "39"], 0);
    const yacine = await seedBorrower();

    await move({
      reason: "arrival",
      items: [
        { inventoryId: white.inv("38"), quantity: 6 },
        { inventoryId: white.inv("39"), quantity: 4 },
      ],
    });
    await move({ reason: "sale", items: [{ inventoryId: white.inv("38"), quantity: 3 }] });
    await move({ reason: "retour", items: [{ inventoryId: white.inv("38"), quantity: 1 }] });
    await move({ reason: "lend", items: [{ inventoryId: white.inv("39"), quantity: 2 }], borrowerId: yacine.id });
    await move({ reason: "borrower-sale", items: [{ inventoryId: white.inv("39"), quantity: 1 }], borrowerId: yacine.id });

    expect(await summary({ shoeIds: [white.shoeId] })).toEqual([
      {
        shoeId: white.shoeId,
        modelName: "Air Force 1",
        color: "White",
        arrived: 10,
        sold: 4,
        cameBack: 1,
        atBorrowers: 1,
        inStock: 7,
      },
    ]);
  });

  it("gives a selected colour with no history a row of zeroes", async () => {
    const white = await seedShoe("White", ["38"], 3);

    expect(await summary({ shoeIds: [white.shoeId] })).toMatchObject([
      { arrived: 0, sold: 0, cameBack: 0, atBorrowers: 0, inStock: 3 },
    ]);
  });

  it("follows the size and date filters for the ledger sums", async () => {
    const white = await seedShoe("White", ["38", "39"]);
    await datedMove({ reason: "sale", items: [{ inventoryId: white.inv("38"), quantity: 1 }] }, "2026-03-01T12:00:00Z");
    await datedMove({ reason: "sale", items: [{ inventoryId: white.inv("38"), quantity: 2 }] }, "2026-03-05T12:00:00Z");
    await datedMove({ reason: "sale", items: [{ inventoryId: white.inv("39"), quantity: 4 }] }, "2026-03-05T12:00:00Z");

    const [row] = await summary({ shoeIds: [white.shoeId], sizes: ["38"], from: "2026-03-04" });

    expect(row).toMatchObject({ sold: 2, inStock: 7 });
  });

  // A Reconstructed Movement has no reversal row of its own: the past recorded
  // that the order came back, never when. The order's status is all there is.
  describe("a reconstructed sale", () => {
    async function reconstructedSale(inventoryId: string, orderId: string, quantity = 1) {
      await db.insert(stockMovements).values({
        groupId: crypto.randomUUID(),
        shoeInventoryId: inventoryId,
        reason: "sale",
        requested: quantity,
        delta: -quantity,
        orderId,
        reconstructed: true,
      });
    }

    it("counts as came back once its order reads retour or cancelled", async () => {
      const white = await seedShoe("White", ["38"]);
      await seedOrder("DHD-1", RETURNED_STATUS_ID);
      await seedOrder("DHD-2", CANCELED_STATUS_ID);
      await seedOrder("DHD-3", DELIVERED_STATUS_ID);
      await reconstructedSale(white.inv("38"), "DHD-1", 2);
      await reconstructedSale(white.inv("38"), "DHD-2");
      await reconstructedSale(white.inv("38"), "DHD-3");

      expect(await summary({ shoeIds: [white.shoeId] })).toMatchObject([
        { sold: 4, cameBack: 3 },
      ]);
    });

    it("is not counted twice when the retour was recorded live", async () => {
      const white = await seedShoe("White", ["38"]);
      await seedOrder("DHD-1", RETURNED_STATUS_ID);
      await reconstructedSale(white.inv("38"), "DHD-1");
      await move({ reason: "retour", items: [{ inventoryId: white.inv("38"), quantity: 1 }], orderId: "DHD-1" });

      expect(await summary({ shoeIds: [white.shoeId] })).toMatchObject([
        { sold: 1, cameBack: 1 },
      ]);
    });

    it("never counts an Échange the resolver decided by its status: its stock is settled by its own rows", async () => {
      const white = await seedShoe("White", ["38"]);
      await seedOrder("DHD-1", RETURNED_STATUS_ID, {
        type: 2,
        echangeResolvedAt: new Date("2026-10-05T08:00:00Z"),
      });
      await reconstructedSale(white.inv("38"), "DHD-1");

      expect(await summary({ shoeIds: [white.shoeId] })).toMatchObject([
        { sold: 1, cameBack: 0 },
      ]);
    });
  });
});
