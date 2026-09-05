import { db, txClient, type Executor } from "@/lib/db";
import { LendedShoes, orderItems, ordersTable, shoeInventory } from "@/lib/schema";
import { applyMovement } from "@/lib/stock/movement";
import { getProvider, type DeliveryProvider, type DeliveryProviderName } from "@/lib/delivery";
import { and, eq, inArray, sql } from "drizzle-orm";
import { canonicalPhone } from "@/lib/orders/phone";

/**
 * The shape every order-creation form builds and `POST /api/order` accepts.
 * Import this instead of re-typing the fields, so renaming one fails
 * `npx tsc --noEmit` in every form that builds it, instead of silently
 * breaking whichever form nobody remembered to update.
 */
export type OrderDraft = {
  nom_client: string;
  telephone: string;
  telephone_2: string | null;
  adresse: string;
  commune: string;
  code_wilaya: string;
  montant: string;
  remarque: string | null;
  produit: string;
  type: number;
  stop_desk: number;
  source: string;
  selectedSizeShoeId: string[];
  provider: DeliveryProviderName | null;
  borrowerId: string | null;
};

/**
 * The fields a single-shoe order form collects directly (customer + delivery
 * info). `produit`, `source`, `provider`, `borrowerId` and
 * `selectedSizeShoeId` are computed at submit time, not held in this state.
 */
export type OrderFormFields = Pick<
  OrderDraft,
  | "nom_client"
  | "telephone"
  | "telephone_2"
  | "adresse"
  | "commune"
  | "code_wilaya"
  | "montant"
  | "remarque"
  | "type"
  | "stop_desk"
>;

export type PlaceOrderResult =
  | { ok: true; orderId: string }
  | { ok: false; status: number; error: string };

export type PlaceOrderDeps = {
  /** Reaches the courier. Defaults to the normal lookup by `draft.provider`; tests pass a fake. */
  provider?: DeliveryProvider;
  /** Defaults to opening its own `txClient().transaction()`; tests pass a test-db handle. */
  exec?: Executor;
};

function reject(status: number, error: string): PlaceOrderResult {
  return { ok: false, status, error };
}

/**
 * Validates the draft, checks Borrower holdings for a borrower-placed sale,
 * reaches the courier, and — only once the courier confirms a tracking
 * number — writes the order, its lines and the Stock Movement atomically.
 * A courier failure returns before any of that write happens, so the
 * operator never chases a tracking number that does not exist.
 */
export async function placeOrder(
  draft: OrderDraft,
  deps: PlaceOrderDeps = {},
): Promise<PlaceOrderResult> {
  const {
    nom_client,
    telephone: rawTelephone,
    telephone_2: rawTelephone2,
    adresse,
    commune,
    code_wilaya,
    montant,
    remarque,
    produit,
    type,
    stop_desk,
    source,
    selectedSizeShoeId,
    borrowerId,
  } = draft;

  if (!nom_client) {
    return reject(400, "Nom client (Customer name) is required.");
  }
  if (!selectedSizeShoeId || selectedSizeShoeId.length === 0) {
    return reject(400, "Selected size ID is required.");
  }
  if (!rawTelephone) {
    return reject(400, "Telephone is required.");
  }

  // Store one spelling of a number, not whatever the form happened to send.
  // Only the storefront checkout validates the shape; the two admin forms pass
  // their raw input straight through, which is how the table came to hold
  // "0770 205 202" and "+213555605770". Equality on this column is the Delivery
  // Record's notion of "the same customer", so it has to mean something.
  //
  // `canonicalPhone` is idempotent, and returns null only for input with no
  // digits at all — in that case the original is kept rather than a number
  // being invented. The courier is handed the canonical form too: it is the
  // better input, and it keeps the parcel matching what we stored.
  const telephone = canonicalPhone(rawTelephone) ?? rawTelephone;
  const telephone_2 = rawTelephone2
    ? (canonicalPhone(rawTelephone2) ?? rawTelephone2)
    : rawTelephone2;
  if (!adresse) {
    return reject(400, "Adresse (Address) is required.");
  }
  if (!commune) {
    return reject(400, "Commune is required.");
  }
  if (!code_wilaya) {
    return reject(400, "Code wilaya is required.");
  }
  if (!montant) {
    return reject(400, "Montant (Amount) is required.");
  }
  if (!produit) {
    return reject(400, "Produit (Product) is required.");
  }
  if (!type) {
    return reject(400, "Type is required.");
  }
  if (isNaN(stop_desk) || stop_desk < 0) {
    return reject(400, "Stop desk is required.");
  }

  const provider = deps.provider ?? getProvider(draft.provider);
  const readExec = (deps.exec ?? db) as typeof db;

  // Honour line multiplicity: the same variant selected twice is one
  // orderItems row with quantity = n, and stock moves by n.
  const countsByInventoryId = new Map<string, number>();
  for (const id of selectedSizeShoeId) {
    countsByInventoryId.set(id, (countsByInventoryId.get(id) ?? 0) + 1);
  }
  const items = Array.from(countsByInventoryId, ([inventoryId, quantity]) => ({
    inventoryId,
    quantity,
  }));

  // Selling decrements Physical Quantity (shoeInventory.quantity) regardless
  // of who sells it, and applyMovement floors at zero instead of rejecting —
  // so refuse here rather than let a sale go through with no stock backing it.
  const stockRows = await readExec
    .select({ id: shoeInventory.id, quantity: shoeInventory.quantity })
    .from(shoeInventory)
    .where(
      inArray(
        shoeInventory.id,
        items.map((i) => i.inventoryId),
      ),
    );
  const stockMap = new Map(stockRows.map((r) => [r.id, r.quantity]));
  const outOfStock = items.filter(
    (item) => (stockMap.get(item.inventoryId) ?? 0) < item.quantity,
  );
  if (outOfStock.length > 0) {
    return reject(400, "Insufficient stock for one or more selected items.");
  }

  // For a borrower-placed order, make sure the borrower actually holds
  // enough of each selected variant before we let them sell it.
  if (borrowerId) {
    const holdings = await readExec
      .select({
        inventoryId: LendedShoes.shoeInventoryId,
        held: sql<number>`COALESCE(SUM(${LendedShoes.quantity}), 0)`,
      })
      .from(LendedShoes)
      .where(
        and(
          eq(LendedShoes.borrowerId, borrowerId),
          inArray(
            LendedShoes.shoeInventoryId,
            items.map((i) => i.inventoryId),
          ),
        ),
      )
      .groupBy(LendedShoes.shoeInventoryId);

    const heldMap = new Map(holdings.map((h) => [h.inventoryId, Number(h.held)]));
    const missing = items.filter(
      (item) => (heldMap.get(item.inventoryId) ?? 0) < item.quantity,
    );
    if (missing.length > 0) {
      return reject(400, "This borrower does not hold one or more selected items.");
    }
  }

  // Create the parcel with the chosen provider FIRST (we need the tracking).
  let tracking: string;
  try {
    const created = await provider.createOrder({
      nom_client,
      telephone,
      telephone_2,
      adresse,
      commune,
      code_wilaya,
      montant,
      remarque,
      produit,
      type,
      stop_desk,
    });
    tracking = created.tracking;
  } catch (providerError) {
    return reject(502, `Failed to create order: ${(providerError as Error).message}`);
  }

  async function persist(exec: Executor) {
    const e = exec as typeof db;

    await e.insert(ordersTable).values({
      id: tracking,
      reference: produit,
      nom_client,
      telephone,
      telephone_2,
      adresse,
      commune,
      code_wilaya,
      montant,
      remarque,
      type,
      stop_desk,
      source,
      provider: provider.name,
      borrowerId: borrowerId ?? null,
    });

    await e.insert(orderItems).values(
      items.map((item) => ({
        orderId: tracking,
        shoeInventoryId: item.inventoryId,
        quantity: item.quantity,
      })),
    );

    await applyMovement(
      {
        reason: borrowerId ? "borrower-sale" : "sale",
        items,
        borrowerId: borrowerId ?? undefined,
        orderId: tracking,
      },
      exec,
    );
  }

  if (deps.exec) {
    await persist(deps.exec);
  } else {
    await txClient().transaction((tx) => persist(tx));
  }

  return { ok: true, orderId: tracking };
}
