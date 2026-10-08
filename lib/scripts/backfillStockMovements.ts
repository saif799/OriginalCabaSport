/**
 * One-shot: fill the Movement Ledger with what happened before it existed
 * (ADR-0010) — Reconstructed Movements, rebuilt from arrivages, orders, store
 * sales, decided Échanges and the Borrower ledger. The rules live in
 * `lib/stock/backfill.ts`; this is only the command line around them.
 *
 * It writes `stock_movements` rows flagged `reconstructed` and nothing else:
 * no Physical Quantity, no Holdings, no gallery flag.
 *
 * Run it after `pnpm push` has created the table and the code that writes the
 * ledger live is deployed — everything recorded live from then on is
 * recognised and left out.
 *
 * Run from repo root:
 *   npx tsx lib/scripts/backfillStockMovements.ts          # dry run, prints the counts
 *   npx tsx lib/scripts/backfillStockMovements.ts --apply  # writes the rows
 *
 * Safe to re-run: `--apply` replaces every reconstructed row in one
 * transaction, and never touches a live one.
 */

// First, so DATABASE_URL is set before anything reads it.
import "dotenv/config";

import { backfillStockMovements } from "@/lib/stock/backfill";

async function main() {
  const apply = process.argv.includes("--apply");
  const result = await backfillStockMovements({ apply });

  console.log(`${result.total} Reconstructed Movement(s):\n`);
  for (const [reason, count] of Object.entries(result.counts).sort()) {
    console.log(`  ${reason.padEnd(16)}${count}`);
  }

  if (!result.applied) {
    console.log(
      `\nDry run. Re-run with --apply to write them` +
        (result.replaced > 0
          ? `, replacing the ${result.replaced} already in the ledger.`
          : "."),
    );
    return;
  }
  console.log(
    `\nWritten.` +
      (result.replaced > 0 ? ` Replaced ${result.replaced} from an earlier run.` : ""),
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
