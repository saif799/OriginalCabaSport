import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  LendedShoes,
  borrower,
  orderItems,
  ordersTable,
  shoeInventory,
  shoeModels,
  shoes,
  stautsGroupsTable,
} from "@/lib/schema";
import { placeOrder, placeParcel, type OrderDraft } from "@/lib/orders/placeOrder";
import { applyMovement } from "@/lib/stock/movement";
import { cancelOrder } from "@/lib/orders/cancelOrder";
import {
  getEchangeLinks,
  placeEchange,
  resolveEchanges,
  takesStatusFromOwnTracking,
  type EchangeDraft,
} from "@/lib/orders/echange";
import {
  CANCELED_STATUS_ID,
  DELIVERED_STATUS_ID,
  EN_LIVRAISON_STATUS_ID,
  READY_TO_SHIP_STATUS_ID,
  READY_TO_SHIP_STATUS_NAME,
  RETURNED_STATUS_ID,
} from "@/lib/orders/status";
import { createTestDb, type TestDb } from "../testDb";
import type { Executor } from "@/lib/db";
import type {
  DeliveryProvider,
  NormalizedOrderInput,
  ProviderStatus,
} from "@/lib/delivery";

let db: TestDb;

async function seedVariant(quantity: number, color = "White") {
  const [model] = await db
    .insert(shoeModels)
    .values({ modelName: "Air Force 1", basePrice: 10000 })
    .returning();
  const [shoe] = await db
    .insert(shoes)
    .values({ id: `shoe-${crypto.randomUUID()}`, modelId: model.id, color })
    .returning();
  const [inv] = await db
    .insert(shoeInventory)
    .values({ shoeId: shoe.id, size: "42", quantity })
    .returning();
  return inv;
}

async function quantityOf(inventoryId: string) {
  const [row] = await db
    .select({ quantity: shoeInventory.quantity })
    .from(shoeInventory)
    .where(eq(shoeInventory.id, inventoryId));
  return row.quantity;
}

function fakeProvider(overrides: Partial<DeliveryProvider> = {}): DeliveryProvider {
  return {
    name: "dhd",
    createOrder: async () => ({ tracking: `DHD-${crypto.randomUUID()}` }),
    deleteOrder: async () => ({ ok: true }),
    fetchStatuses: async () => [],
    ...overrides,
  };
}

const deps = (provider = fakeProvider()) => ({
  exec: db as unknown as Executor,
  provider,
});

/** A delivered DHD order for `inventoryIds`, standing in for the Original Order. */
async function deliveredOrder(inventoryIds: string[], overrides: Partial<OrderDraft> = {}) {
  const result = await placeOrder(
    {
      nom_client: "Yacine",
      telephone: "0555000000",
      telephone_2: null,
      adresse: "Alger centre",
      commune: "Alger Centre",
      code_wilaya: "16",
      montant: "10000",
      remarque: null,
      produit: "Air Force 1",
      type: 1,
      stop_desk: 0,
      source: "i",
      selectedSizeShoeId: inventoryIds,
      provider: "dhd",
      borrowerId: null,
      ...overrides,
    },
    deps(),
  );
  if (!result.ok) throw new Error(result.error);
  await db
    .update(ordersTable)
    .set({ statusId: DELIVERED_STATUS_ID })
    .where(eq(ordersTable.id, result.orderId));
  const lines = await db
    .select({ id: orderItems.id, inventoryId: orderItems.shoeInventoryId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, result.orderId));
  return { id: result.orderId, lines };
}

function echangeDraft(
  originalOrderId: string,
  returns: EchangeDraft["returns"],
  outgoing: string[],
  overrides: Partial<EchangeDraft> = {},
): EchangeDraft {
  return {
    originalOrderId,
    returns,
    outgoing,
    nom_client: "Yacine",
    telephone: "0555000000",
    telephone_2: null,
    adresse: "Alger centre",
    commune: "Alger Centre",
    code_wilaya: "16",
    stop_desk: 0,
    montant: "0",
    remarque: null,
    ...overrides,
  };
}

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(stautsGroupsTable).values([
    { id: READY_TO_SHIP_STATUS_ID, name: READY_TO_SHIP_STATUS_NAME },
    // A Delivery Leg only comes back from trackings/info, which speaks in
    // French labels rather than get/orders' snake_case codes.
    { id: DELIVERED_STATUS_ID, name: "Livre", external_statuses: ["livré_non_encaissé", "Livre non encaissé"] },
    { id: RETURNED_STATUS_ID, name: "retour", external_statuses: ["retour_recu", "Retours prêts"] },
    { id: CANCELED_STATUS_ID, name: "Cancel" },
  ]);
});

describe("placeEchange", () => {
  it("sends the Outgoing Pair through DHD as a type 2 order and takes it out of stock", async () => {
    const returnedPair = await seedVariant(1);
    const outgoingPair = await seedVariant(3, "Black");
    const original = await deliveredOrder([returnedPair.id]);

    let sent: NormalizedOrderInput | undefined;
    const provider = fakeProvider({
      createOrder: async (input) => {
        sent = input;
        return { tracking: "DHD-ECH-1" };
      },
    });

    const result = await placeEchange(
      echangeDraft(original.id, [{ orderItemId: original.lines[0].id, quantity: 1 }], [outgoingPair.id]),
      deps(provider),
    );

    expect(result).toEqual({ ok: true, orderId: "DHD-ECH-1" });
    expect(sent?.type).toBe(2);
    const [row] = await db.select().from(ordersTable).where(eq(ordersTable.id, "DHD-ECH-1"));
    expect(row).toMatchObject({ type: 2, provider: "dhd", borrowerId: null, statusId: READY_TO_SHIP_STATUS_ID });
    expect(await quantityOf(outgoingPair.id)).toBe(2);
    // The Returned Pair is still with the customer: nothing comes back yet.
    expect(await quantityOf(returnedPair.id)).toBe(0);
  });

  it("exchanges each pair of an Original Order at most once", async () => {
    const returnedPair = await seedVariant(2);
    const outgoingPair = await seedVariant(5, "Black");
    // Two pairs of the same variant on one line: each can go once, so two
    // Échanges of one pair succeed and a third is refused.
    const original = await deliveredOrder([returnedPair.id, returnedPair.id]);
    const line = original.lines[0];
    expect(line.quantity).toBe(2);

    let created = 0;
    const provider = fakeProvider({
      createOrder: async () => ({ tracking: `DHD-ECH-${++created}` }),
    });
    const once = () =>
      placeEchange(
        echangeDraft(original.id, [{ orderItemId: line.id, quantity: 1 }], [outgoingPair.id]),
        deps(provider),
      );

    expect((await once()).ok).toBe(true);
    expect((await once()).ok).toBe(true);
    const third = await once();

    expect(third).toEqual({
      ok: false,
      status: 409,
      error: "One of these pairs has already been exchanged.",
    });
    // Refused before reaching the courier, and nothing left stock.
    expect(created).toBe(2);
    expect(await quantityOf(outgoingPair.id)).toBe(3);
  });

  it("starts only from a delivered DHD order", async () => {
    const returnedPair = await seedVariant(2);
    const outgoingPair = await seedVariant(5, "Black");
    const inFlight = await deliveredOrder([returnedPair.id]);
    await db
      .update(ordersTable)
      .set({ statusId: READY_TO_SHIP_STATUS_ID })
      .where(eq(ordersTable.id, inFlight.id));
    const yalidine = await deliveredOrder([returnedPair.id]);
    await db
      .update(ordersTable)
      .set({ provider: "yalidine" })
      .where(eq(ordersTable.id, yalidine.id));

    for (const original of [inFlight, yalidine]) {
      const result = await placeEchange(
        echangeDraft(original.id, [{ orderItemId: original.lines[0].id, quantity: 1 }], [outgoingPair.id]),
        deps(),
      );
      expect(result).toMatchObject({ ok: false, status: 400 });
    }
    expect(await quantityOf(outgoingPair.id)).toBe(5);
  });

  it("refuses to take back more pairs than the line holds in one Échange", async () => {
    const returnedPair = await seedVariant(1);
    const outgoingPair = await seedVariant(5, "Black");
    const original = await deliveredOrder([returnedPair.id]);

    const result = await placeEchange(
      echangeDraft(original.id, [{ orderItemId: original.lines[0].id, quantity: 2 }], [outgoingPair.id]),
      deps(),
    );

    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(await quantityOf(outgoingPair.id)).toBe(5);
  });
});

const HOUR = 60 * 60 * 1000;
const T0 = new Date("2026-10-06T08:00:00Z");

async function statusOf(orderId: string) {
  const [row] = await db
    .select({ statusId: ordersTable.statusId })
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId));
  return row.statusId;
}

/** trackings/info as DHD answers it: only the trackings it knows, keyed by tracking. */
function legLookup(delivered: string[] = []) {
  const asked: string[][] = [];
  const fetchLegStatuses = async (trackings: string[]): Promise<ProviderStatus[]> => {
    asked.push(trackings);
    return trackings
      .filter((t) => delivered.includes(t))
      .map((tracking) => ({ tracking, status: "Livre non encaissé" }));
  };
  return { asked, fetchLegStatuses };
}

/** An Original Order of one pair, exchanged for one other: its Returned and Outgoing Pairs. */
async function placedEchange() {
  const returnedPair = await seedVariant(1);
  const outgoingPair = await seedVariant(3, "Black");
  const original = await deliveredOrder([returnedPair.id]);
  const result = await placeEchange(
    echangeDraft(original.id, [{ orderItemId: original.lines[0].id, quantity: 1 }], [outgoingPair.id]),
    deps(fakeProvider({ createOrder: async () => ({ tracking: "DHD-ECH-1" }) })),
  );
  if (!result.ok) throw new Error(result.error);
  return { returnedPair, outgoingPair, original, echangeId: result.orderId };
}

describe("resolveEchanges", () => {
  it("a delivered Delivery Leg completes the swap: the Échange is delivered and the Returned Pair is back in stock", async () => {
    const { returnedPair, outgoingPair, original, echangeId } = await placedEchange();
    const legs = legLookup([`${echangeId}-EXCH`]);

    const resolution = await resolveEchanges([echangeId], {
      exec: db as unknown as Executor,
      now: T0,
      fetchLegStatuses: legs.fetchLegStatuses,
    });

    expect(resolution).toEqual({ delivered: [echangeId], refused: [], pending: [] });
    expect(legs.asked).toEqual([[`${echangeId}-EXCH`]]);
    expect(await statusOf(echangeId)).toBe(DELIVERED_STATUS_ID);
    expect(await quantityOf(returnedPair.id)).toBe(1);
    // The customer kept the Outgoing Pair.
    expect(await quantityOf(outgoingPair.id)).toBe(2);
    // The swap happened inside a sale that happened: the Original Order stays delivered.
    expect(await statusOf(original.id)).toBe(DELIVERED_STATUS_ID);
  });

  it("a borrower-placed Original Order gets its Returned Pair back into that Borrower's Holdings", async () => {
    const returnedPair = await seedVariant(1);
    const outgoingPair = await seedVariant(3, "Black");
    const [b] = await db.insert(borrower).values({ name: "Yacine" }).returning();
    await applyMovement(
      { reason: "lend", items: [{ inventoryId: returnedPair.id, quantity: 1 }], borrowerId: b.id },
      db as unknown as Executor,
    );
    const original = await deliveredOrder([returnedPair.id], { borrowerId: b.id });
    const placed = await placeEchange(
      echangeDraft(original.id, [{ orderItemId: original.lines[0].id, quantity: 1 }], [outgoingPair.id]),
      deps(),
    );
    if (!placed.ok) throw new Error(placed.error);

    await resolveEchanges([placed.orderId], {
      exec: db as unknown as Executor,
      now: T0,
      fetchLegStatuses: legLookup([`${placed.orderId}-EXCH`]).fetchLegStatuses,
    });

    expect(await quantityOf(returnedPair.id)).toBe(1);
    const held = await db
      .select({ quantity: LendedShoes.quantity })
      .from(LendedShoes)
      .where(eq(LendedShoes.borrowerId, b.id));
    expect(held.reduce((sum, r) => sum + r.quantity, 0)).toBe(1);
  });

  it("no Delivery Leg 24h after the Return Leg went back is a Refused Échange: the Outgoing Pair comes back", async () => {
    const { returnedPair, outgoingPair, original, echangeId } = await placedEchange();
    const legs = legLookup();
    const exec = db as unknown as Executor;

    await resolveEchanges([echangeId], { exec, now: T0, fetchLegStatuses: legs.fetchLegStatuses });
    const resolution = await resolveEchanges([echangeId], {
      exec,
      now: new Date(T0.getTime() + 24 * HOUR),
      fetchLegStatuses: legs.fetchLegStatuses,
    });

    expect(resolution).toEqual({ delivered: [], refused: [echangeId], pending: [] });
    expect(await statusOf(echangeId)).toBe(RETURNED_STATUS_ID);
    expect(await quantityOf(outgoingPair.id)).toBe(3);
    // The customer kept their pair, and their order.
    expect(await quantityOf(returnedPair.id)).toBe(0);
    expect(await statusOf(original.id)).toBe(DELIVERED_STATUS_ID);
  });

  it("no Delivery Leg less than 24h after the Return Leg went back decides nothing yet", async () => {
    const { returnedPair, outgoingPair, echangeId } = await placedEchange();
    const legs = legLookup();
    const exec = db as unknown as Executor;

    await resolveEchanges([echangeId], { exec, now: T0, fetchLegStatuses: legs.fetchLegStatuses });
    const resolution = await resolveEchanges([echangeId], {
      exec,
      now: new Date(T0.getTime() + 23 * HOUR),
      fetchLegStatuses: legs.fetchLegStatuses,
    });

    expect(resolution).toEqual({ delivered: [], refused: [], pending: [echangeId] });
    expect(await statusOf(echangeId)).toBe(READY_TO_SHIP_STATUS_ID);
    expect(await quantityOf(outgoingPair.id)).toBe(2);
    expect(await quantityOf(returnedPair.id)).toBe(0);
  });

  it("keeps asking after the Return Leg stops being reported, so it still refuses at 24h", async () => {
    const { outgoingPair, echangeId } = await placedEchange();
    const legs = legLookup();
    const exec = db as unknown as Executor;

    await resolveEchanges([echangeId], { exec, now: T0, fetchLegStatuses: legs.fetchLegStatuses });
    // get/orders no longer lists the parcel at all.
    const resolution = await resolveEchanges([], {
      exec,
      now: new Date(T0.getTime() + 25 * HOUR),
      fetchLegStatuses: legs.fetchLegStatuses,
    });

    expect(resolution.refused).toEqual([echangeId]);
    expect(await quantityOf(outgoingPair.id)).toBe(3);
  });

  it("a decided Échange is never looked at again", async () => {
    const { returnedPair, echangeId } = await placedEchange();
    const exec = db as unknown as Executor;
    await resolveEchanges([echangeId], {
      exec,
      now: T0,
      fetchLegStatuses: legLookup([`${echangeId}-EXCH`]).fetchLegStatuses,
    });

    // DHD keeps reporting the Return Leg for days; even with the Delivery Leg
    // gone from the lookup, nothing about the Échange moves again.
    const later = legLookup();
    const resolution = await resolveEchanges([echangeId], {
      exec,
      now: new Date(T0.getTime() + 72 * HOUR),
      fetchLegStatuses: later.fetchLegStatuses,
    });

    expect(resolution).toEqual({ delivered: [], refused: [], pending: [] });
    expect(later.asked).toEqual([]);
    expect(await statusOf(echangeId)).toBe(DELIVERED_STATUS_ID);
    expect(await quantityOf(returnedPair.id)).toBe(1);
  });

  it("never reads a failed lookup as a missing Delivery Leg", async () => {
    const { outgoingPair, echangeId } = await placedEchange();
    const exec = db as unknown as Executor;
    await resolveEchanges([echangeId], { exec, now: T0, fetchLegStatuses: legLookup().fetchLegStatuses });

    const resolution = await resolveEchanges([echangeId], {
      exec,
      now: new Date(T0.getTime() + 48 * HOUR),
      fetchLegStatuses: async () => {
        throw new Error("DHD is down");
      },
    });

    expect(resolution).toEqual({ delivered: [], refused: [], pending: [echangeId] });
    expect(await statusOf(echangeId)).toBe(READY_TO_SHIP_STATUS_ID);
    expect(await quantityOf(outgoingPair.id)).toBe(2);
  });

  describe("a Legacy Échange (no Original Order linked)", () => {
    /** Placed the way the Service Type dropdown used to: a bare type 2 order. */
    async function legacyEchange(tracking: string) {
      const outgoing = await seedVariant(2);
      const result = await placeParcel(
        {
          nom_client: "Yacine",
          telephone: "0555000000",
          telephone_2: null,
          adresse: "Alger centre",
          commune: "Alger Centre",
          code_wilaya: "16",
          montant: "400",
          remarque: null,
          produit: "Air Force 1",
          type: 2,
          stop_desk: 0,
          source: "i",
          selectedSizeShoeId: [outgoing.id],
          provider: "dhd",
          borrowerId: null,
        },
        deps(fakeProvider({ createOrder: async () => ({ tracking }) })),
      );
      if (!result.ok) throw new Error(result.error);
      return { outgoing, echangeId: result.orderId };
    }

    it("is marked delivered when its Delivery Leg is, with no stock movement", async () => {
      const { outgoing, echangeId } = await legacyEchange("DHD-LEGACY-1");

      const resolution = await resolveEchanges([echangeId], {
        exec: db as unknown as Executor,
        now: T0,
        fetchLegStatuses: legLookup([`${echangeId}-EXCH`]).fetchLegStatuses,
      });

      expect(resolution.delivered).toEqual([echangeId]);
      expect(await statusOf(echangeId)).toBe(DELIVERED_STATUS_ID);
      expect(await quantityOf(outgoing.id)).toBe(1);
    });

    it("is marked returned when refused, with no stock movement", async () => {
      const { outgoing, echangeId } = await legacyEchange("DHD-LEGACY-2");
      const exec = db as unknown as Executor;
      const legs = legLookup();

      await resolveEchanges([echangeId], { exec, now: T0, fetchLegStatuses: legs.fetchLegStatuses });
      const resolution = await resolveEchanges([echangeId], {
        exec,
        now: new Date(T0.getTime() + 25 * HOUR),
        fetchLegStatuses: legs.fetchLegStatuses,
      });

      expect(resolution.refused).toEqual([echangeId]);
      expect(await statusOf(echangeId)).toBe(RETURNED_STATUS_ID);
      expect(await quantityOf(outgoing.id)).toBe(1);
    });
  });
});

describe("placeOrder", () => {
  it("refuses an Échange with no Original Order to link it to", async () => {
    const inv = await seedVariant(2);
    const result = await placeOrder(
      {
        nom_client: "Yacine",
        telephone: "0555000000",
        telephone_2: null,
        adresse: "Alger centre",
        commune: "Alger Centre",
        code_wilaya: "16",
        montant: "400",
        remarque: null,
        produit: "Air Force 1",
        type: 2,
        stop_desk: 0,
        source: "i",
        selectedSizeShoeId: [inv.id],
        provider: "dhd",
        borrowerId: null,
      },
      deps(),
    );

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(await quantityOf(inv.id)).toBe(2);
  });
});

describe("cancelOrder", () => {
  it("cancelling an Échange puts its Outgoing Pair back and makes the Original Order's pair exchangeable again", async () => {
    const { outgoingPair, original, echangeId } = await placedEchange();

    const result = await cancelOrder(echangeId, deps());

    expect(result).toMatchObject({ ok: true });
    expect(await statusOf(echangeId)).toBe(CANCELED_STATUS_ID);
    expect(await quantityOf(outgoingPair.id)).toBe(3);

    const again = await placeEchange(
      echangeDraft(original.id, [{ orderItemId: original.lines[0].id, quantity: 1 }], [outgoingPair.id]),
      deps(),
    );
    expect(again.ok).toBe(true);
  });

  it("refuses to cancel an Échange once it has left ready-to-ship, before asking the courier", async () => {
    const { returnedPair, echangeId } = await placedEchange();
    await resolveEchanges([echangeId], {
      exec: db as unknown as Executor,
      now: T0,
      fetchLegStatuses: legLookup([`${echangeId}-EXCH`]).fetchLegStatuses,
    });
    let asked = false;

    const result = await cancelOrder(
      echangeId,
      deps(fakeProvider({ deleteOrder: async () => ((asked = true), { ok: true }) })),
    );

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(asked).toBe(false);
    expect(await statusOf(echangeId)).toBe(DELIVERED_STATUS_ID);
    // The swap's restock stands, and is not doubled by a cancel on top.
    expect(await quantityOf(returnedPair.id)).toBe(1);
  });

  it("leaves everything as it was when the courier refuses the deletion", async () => {
    const { outgoingPair, original, echangeId } = await placedEchange();

    const result = await cancelOrder(
      echangeId,
      deps(fakeProvider({ deleteOrder: async () => ({ ok: false }) })),
    );

    expect(result).toMatchObject({ ok: false });
    expect(await statusOf(echangeId)).toBe(READY_TO_SHIP_STATUS_ID);
    expect(await quantityOf(outgoingPair.id)).toBe(2);
    const again = await placeEchange(
      echangeDraft(original.id, [{ orderItemId: original.lines[0].id, quantity: 1 }], [outgoingPair.id]),
      deps(),
    );
    expect(again).toMatchObject({ ok: false, status: 409 });
  });
});

describe("getEchangeLinks", () => {
  it("shows an Original Order its Échange and the pairs still exchangeable, and the Échange its Original Order", async () => {
    const returnedPair = await seedVariant(2);
    const other = await seedVariant(1, "Red");
    const outgoingPair = await seedVariant(3, "Black");
    const original = await deliveredOrder([returnedPair.id, returnedPair.id, other.id]);
    const returnedLine = original.lines.find((l) => l.inventoryId === returnedPair.id)!;
    const placed = await placeEchange(
      echangeDraft(original.id, [{ orderItemId: returnedLine.id, quantity: 1 }], [outgoingPair.id]),
      deps(fakeProvider({ createOrder: async () => ({ tracking: "DHD-ECH-1" }) })),
    );
    if (!placed.ok) throw new Error(placed.error);

    const links = await getEchangeLinks([original.id, "DHD-ECH-1"], db as unknown as Executor);

    expect(links[original.id]).toEqual({
      echangeIds: ["DHD-ECH-1"],
      originalOrderId: null,
      exchangeablePairs: 2,
    });
    expect(links["DHD-ECH-1"]).toEqual({
      echangeIds: [],
      originalOrderId: original.id,
      exchangeablePairs: 1,
    });
  });
});

describe("takesStatusFromOwnTracking", () => {
  /** The status sync's write: move `orderId` to `statusId`, if the guard lets it. */
  async function syncWrite(orderId: string, statusId: string) {
    const moved = await db
      .update(ordersTable)
      .set({ statusId })
      .where(and(eq(ordersTable.id, orderId), takesStatusFromOwnTracking(statusId)))
      .returning({ id: ordersTable.id });
    return moved.length === 1;
  }

  beforeEach(async () => {
    await db
      .insert(stautsGroupsTable)
      .values({ id: EN_LIVRAISON_STATUS_ID, name: "en livraison" });
  });

  it("lets an undecided Échange move through in-flight statuses only", async () => {
    const { echangeId } = await placedEchange();

    expect(await syncWrite(echangeId, EN_LIVRAISON_STATUS_ID)).toBe(true);
    // Delivered and returned are decided from the Delivery Leg, never from
    // the Échange's own tracking.
    expect(await syncWrite(echangeId, DELIVERED_STATUS_ID)).toBe(false);
    expect(await syncWrite(echangeId, RETURNED_STATUS_ID)).toBe(false);
  });

  it("gives a decided Échange no status from its own tracking at all", async () => {
    const { echangeId } = await placedEchange();
    await resolveEchanges([echangeId], {
      exec: db as unknown as Executor,
      now: T0,
      fetchLegStatuses: legLookup([`${echangeId}-EXCH`]).fetchLegStatuses,
    });

    expect(await syncWrite(echangeId, EN_LIVRAISON_STATUS_ID)).toBe(false);
    expect(await syncWrite(echangeId, RETURNED_STATUS_ID)).toBe(false);
    expect(await statusOf(echangeId)).toBe(DELIVERED_STATUS_ID);
  });

  it("leaves every other order to its own tracking", async () => {
    const inv = await seedVariant(1);
    const order = await deliveredOrder([inv.id]);

    expect(await syncWrite(order.id, RETURNED_STATUS_ID)).toBe(true);
  });
});
