import Listings from "@/components/Listings";
import { db } from "@/lib/db";
import { primaryImageByShoeId } from "@/lib/images";
import {
  shoeInventory,
  shoes,
  shoeModels,
  LendedShoes,
  borrower,
} from "@/lib/schema";
import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { connection } from "next/server";
import BorrowerActions from "@/components/borrowerActions";
import BorrowerHistory from "@/components/borrowerHistory";
import AdminPage from "@/components/admin/AdminPage";
import type { GroupedProduct } from "@/app/admin/(admin)/page";
import { historyHref } from "@/app/admin/(admin)/history/params";

export default async function BorrowerDetailPage({
  params,
}: {
  params: Promise<{ lenderId: string }>;
}) {
  const { lenderId } = await params;
  await connection();

  const products = await db
    .select({
      id: shoeInventory.id,
      shoeId: shoes.id,
      modelId: shoes.modelId,
      color: shoes.color,
      quantity: sql<number>`SUM(${LendedShoes.quantity})`,
      size: shoeInventory.size,
      modelName: shoeModels.modelName,
    })
    .from(shoes)
    .innerJoin(shoeInventory, eq(shoes.id, shoeInventory.shoeId))
    .innerJoin(LendedShoes, eq(shoeInventory.id, LendedShoes.shoeInventoryId))
    .innerJoin(shoeModels, eq(shoes.modelId, shoeModels.id))
    .where(eq(LendedShoes.borrowerId, lenderId))
    .groupBy(
      shoeInventory.id,
      shoes.id,
      shoes.modelId,
      shoes.color,
      shoeInventory.size,
      shoeModels.modelName,
    )
    .having(sql`SUM(${LendedShoes.quantity}) > 0`);

  const imageByShoe = await primaryImageByShoeId();

  const models = await db.select().from(shoeModels);

  const [borrowerRow] = await db
    .select({ name: borrower.name })
    .from(borrower)
    .where(eq(borrower.id, lenderId))
    .limit(1);

  const history = await db
    .select({
      id: LendedShoes.id,
      quantity: LendedShoes.quantity,
      createdAt: LendedShoes.createdAt,
      size: shoeInventory.size,
      modelName: shoeModels.modelName,
      color: shoes.color,
    })
    .from(LendedShoes)
    .innerJoin(shoeInventory, eq(LendedShoes.shoeInventoryId, shoeInventory.id))
    .innerJoin(shoes, eq(shoeInventory.shoeId, shoes.id))
    .innerJoin(shoeModels, eq(shoes.modelId, shoeModels.id))
    .where(eq(LendedShoes.borrowerId, lenderId))
    .orderBy(desc(LendedShoes.createdAt));

  const groupedMap = new Map<string, GroupedProduct>();

  products.forEach((product) => {
    const key = product.shoeId;

    let group = groupedMap.get(key);
    if (!group) {
      group = {
        shoeId: product.shoeId,
        modelId: product.modelId,
        modelName: product.modelName,
        color: product.color,
        primaryImageUrl: imageByShoe.get(product.shoeId) ?? null,
        sizes: [],
      };
      groupedMap.set(key, group);
    }

    group.sizes.push({
      inventoryId: product.id,
      size: product.size,
      quantity: product.quantity,
    });
  });

  const groupedProducts = Array.from(groupedMap.values());

  return (
    <AdminPage
      title={borrowerRow?.name ?? "Borrower"}
      description="Stock this borrower is currently holding, and every move behind it."
      width="wide"
      actions={
        borrowerRow ? (
          <BorrowerActions
            borrowerId={lenderId}
            name={borrowerRow.name}
            redirectOnDelete
          />
        ) : null
      }
    >
      <div className="flex flex-col items-center justify-center gap-8">
        <BorrowerHistory history={history} />
        {groupedProducts.length > 0 && (
          // Into the stock history, narrowed to this Borrower's part in it.
          <div className="flex w-full max-w-3xl flex-wrap items-center gap-1.5 text-sm">
            <span className="mr-1 text-muted-foreground">Stock history:</span>
            {groupedProducts.map((product) => (
              <Link
                key={product.shoeId}
                href={historyHref({
                  shoeIds: [product.shoeId],
                  borrowerId: lenderId,
                })}
                className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-accent"
              >
                {product.modelName} — {product.color}
              </Link>
            ))}
          </div>
        )}
        <Listings
          models={models}
          products={groupedProducts}
          borrowerName={borrowerRow?.name}
        />
      </div>
    </AdminPage>
  );
}
