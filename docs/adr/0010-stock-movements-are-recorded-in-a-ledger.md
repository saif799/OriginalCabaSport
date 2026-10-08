# ADR 0010: Stock Movements Are Recorded in a Ledger

## Status
Accepted

## Context
The owner wants to pick a shoe and read what happened to it: arrived, sold, lent, brought back, came back from a customer. Nothing recorded that. `applyMovement` (ADR-0004) mutated `shoe_inventory.quantity` and kept no trace, so history was only partly recoverable from side tables, each with a hole: a correction left nothing at all, a cancel or retour changed an order's status without a date, a reverted store sale deleted its row, and `lended_shoes` kept a signed quantity with no reason — a Borrower's sale and a bring-back are both `-1`.

ADR-0004 had already made `applyMovement` the single point every Stock Movement passes through. That is the one place a complete record can be written.

## Decision
- **A Movement Ledger, `stock_movements`, written by `applyMovement` in the same transaction as the movement.** One row per size touched; the rows of one call share a `groupId`, which is the event the owner did. Each row keeps the reason, what was asked for (`requested`) beside what happened (`delta`, `lendedDelta`), the Physical Quantity on either side, and links to the order, arrivage or Borrower involved.
- **The ledger records; it is never a source of a quantity.** Physical Quantity is still `shoe_inventory.quantity` and Holdings are still `SUM(lended_shoes.quantity)`. Nothing reads a stock level by summing the ledger, so a gap in it cannot make stock wrong — only make history incomplete.
- **The past is backfilled once, as Reconstructed Movements** (`reconstructed = true`), by `lib/scripts/backfillStockMovements.ts`. A side-table row becomes a ledger row only where the past recorded both that something happened and when. Reconstructed rows carry no before/after.
- **An order that came back before the ledger gets its sale and no reversal row.** Its cancel or retour has no date, and a row needs one. The history page shows the order's current status beside the sale, and the summary counts such a sale as came back by reading that status. The exception is an Échange the resolver decided (ADR-0009): `echange_resolved_at` is a real timestamp, so its returning pairs do get a row.
- **Store versus online is derived, not stored**: a `sale` with no order was rung up in the shop.
- **A size created by an arrivage goes through `applyMovement` too**, inserted at zero and then filled, so the ledger has its origin. It is marked `created` and still raises no gallery flag: a size nobody has seen is not a restock.
- **`/admin/history` reads it**, by colour variant, several at once on one timeline, grouped for reading into Event Families.

## Considered Options
- **Derive history from the side tables on read, no new table.** Rejected: it is the status quo's holes made permanent. Corrections and reversal dates are not in any table to derive from.
- **Invent reversal rows for past orders** (date them at the order date, or at `updated_at`). Rejected: `updated_at` is a day that never moved, and a guessed date on a timeline is read as a fact. A status badge says the same thing without claiming when.
- **Make the ledger the source of truth and compute stock from it.** Rejected for now: stock predating the first arrivage has no origin row, so the sums would not reconcile, and every read of a quantity would become an aggregate.
- **Write the ledger from each call site.** Rejected for the reason ADR-0004 exists.

## Consequences
- `stock_movements` joins the tables only `lib/stock` may write (ADR-0004). `applyMovement` writes the live rows; `lib/stock/backfill.ts` writes reconstructed ones and nothing else.
- The ledger's links (`order_id`, `arrival_id`, `borrower_id`) are `ON DELETE SET NULL`: deleting a Borrower must not delete the history of the stock they held.
- Not recoverable, and absent from the history: corrections made before the ledger, the dates of past cancels and retours, reverted store sales, and the origin of stock older than the first arrivage — a shoe's history can start mid-story.
- The backfill is re-runnable: `--apply` replaces every reconstructed row in one transaction and recognises what the ledger recorded live, so running it again after go-live does not duplicate anything. A re-run reads the side tables as they are *then*, so it is a tool for go-live, not for later — once a Borrower has been deleted their `lended_shoes` rows are gone, and a re-run would drop the lends first reconstructed from them.
- A correction can carry a note, typed in `EditInventoryDialog`, which saves every size it changed as one movement (`PATCH /api/inventory`). A correction that changes nothing and says nothing writes no row.
- `applyMovement` now reads Physical Quantity `FOR UPDATE`. The before/after it records are only true if nothing moves the row between its read and its write; the write took that lock already, so this adds no new way to deadlock.
- Day-only records (orders, `lended_shoes`) are placed at the end of their shop day, so a sale never sorts ahead of the timed arrivage that stocked it that morning. Their order within a day is not meaningful.
