/**
 * One-off migration: rewrite `orders.telephone` and `orders.telephone_2` into
 * the canonical `0XXXXXXXXX` form that `canonicalPhone` produces.
 *
 * Why this has to run: the Delivery Record looks a customer's history up with
 * an equality match on `orders.telephone`. That is only correct if the column
 * holds one spelling per number. `lib/orders/placeOrder.ts` now guarantees it
 * for new orders, but rows written before that kept whatever the admin forms
 * sent — `"0770 205 202"`, `" 0562 21 02 59"`, `"0559527433 "`,
 * `"+213555605770"`. Left alone, those customers silently lose their history
 * the moment their next order is stored canonically.
 *
 * Run from repo root:
 *   npx tsx lib/scripts/normalizeOrderPhones.ts          # dry run, prints the plan
 *   npx tsx lib/scripts/normalizeOrderPhones.ts --apply  # writes the changes
 *
 * Safe to re-run: `canonicalPhone` is idempotent, so a second pass finds
 * nothing to do. Numbers with no digits at all are left untouched and reported
 * rather than being replaced with something invented.
 */

import { readFileSync } from "node:fs";

// `.env` is loaded by Next in the app, but a standalone tsx run gets nothing —
// and `dotenv` is not a dependency of this repo.
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (match) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
}

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { ordersTable } from "@/lib/schema";
import { canonicalPhone } from "@/lib/orders/phone";

type Change = {
  id: string;
  column: "telephone" | "telephone_2";
  from: string;
  to: string;
};

async function main() {
  const apply = process.argv.includes("--apply");

  const orders = await db
    .select({
      id: ordersTable.id,
      telephone: ordersTable.telephone,
      telephone_2: ordersTable.telephone_2,
    })
    .from(ordersTable);

  const changes: Change[] = [];
  const unfixable: Array<{ id: string; value: string }> = [];

  for (const order of orders) {
    for (const column of ["telephone", "telephone_2"] as const) {
      const from = order[column];
      if (!from) continue;
      const to = canonicalPhone(from);
      if (to === null) {
        unfixable.push({ id: order.id, value: from });
        continue;
      }
      if (to !== from) changes.push({ id: order.id, column, from, to });
    }
  }

  console.log(`Scanned ${orders.length} orders.`);
  console.log(`${changes.length} value(s) to rewrite.\n`);
  for (const change of changes) {
    console.log(
      `  ${change.id}  ${change.column.padEnd(11)} ${JSON.stringify(change.from).padEnd(20)} -> ${JSON.stringify(change.to)}`,
    );
  }
  if (unfixable.length > 0) {
    console.log(`\n${unfixable.length} value(s) with no digits, left untouched:`);
    for (const row of unfixable) {
      console.log(`  ${row.id}  ${JSON.stringify(row.value)}`);
    }
  }

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to write these changes.");
    return;
  }
  if (changes.length === 0) {
    console.log("\nNothing to write.");
    return;
  }

  for (const change of changes) {
    await db
      .update(ordersTable)
      .set({ [change.column]: change.to })
      .where(eq(ordersTable.id, change.id));
  }
  console.log(`\nWrote ${changes.length} change(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
