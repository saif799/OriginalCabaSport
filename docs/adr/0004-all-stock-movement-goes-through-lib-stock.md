# ADR 0004: All Stock Movement Goes Through `lib/stock`

## Status
Accepted

## Context
Eleven call sites each used to re-derive the whole stock-mutation procedure from scratch: how to mutate `shoeInventory.quantity`, whether to write a `lended_shoes` row, whether availability crossed the zero boundary, whether to flag the Shoe Image Gallery, and which of three different atomicity mechanisms to use (`txClient().transaction()`, a driver-level `db.batch()`, or a bare `db` write with no transaction at all). Two of those call sites silently never flagged the gallery at all, and two more flagged it off the wrong quantity (see ADR-0003) — both bugs survived because there was no single place enforcing the rule.

## Decision
No route, server action, or script writes `shoeInventory.quantity`, `lended_shoes`, or `image_notifier_table` directly. Every Stock Movement — `sale`, `borrower-sale`, `cancel`, `retour`, `arrival`, `lend`, `return`, `correction` — goes through the single entry point `applyMovement` in `lib/stock/movement.ts`, which:
- reads Physical Quantity *before* mutating it, because the zero-crossing decision needs the prior value;
- clamps a decrement at zero rather than letting it go negative;
- writes the Borrower ledger row for `borrower-sale`, `lend`, and `return`, keyed off Physical Quantity's zero-crossing only (never Store-Held Stock — see ADR-0003);
- runs every write for one movement inside a single transaction, either its own or a caller's (via the optional `exec` parameter);
- flags the notifier internally — callers never call the notifier directly.

`applyMovement` deliberately does not import `next/cache`; path revalidation is a separate helper (`lib/stock/revalidate.ts`) so the module stays callable from a plain `tsx` script (e.g. the notifier reconcile script) where revalidation would throw.

## Trade-off against route-local writes
Route-local writes were faster to add in the moment — a route could mutate exactly the columns it cared about without learning the module's vocabulary first. That speed is what produced the two live bugs this refactor fixes: nothing forced a new call site to remember the gallery flag, the zero-crossing rule, or which quantity governs sellability. Centralizing costs a small amount of indirection (every stock-touching route now has one more import and must think in movement reasons rather than raw column writes) in exchange for making the four rules above impossible to accidentally skip. Given that both existing bugs were exactly this kind of accidental omission, that trade is taken deliberately and is expected to hold for any future stock-touching path.

## Consequences
- A new feature that moves stock adds a `MovementReason` (or reuses an existing one) rather than writing to `shoeInventory`/`lended_shoes`/`image_notifier_table` inline.
- The dead bulk inventory-creation endpoint, the size-deletion endpoint, and the single-unit decrement branch of the inventory update endpoint were removed rather than left as unreachable ways to bypass the module.
- Reviewers can grep for direct writes to the three tables outside `lib/stock/` as a correctness check; a match is a bug by construction.
- Since ADR-0010 there is a fourth: `stock_movements`, the Movement Ledger. `applyMovement` writes its live rows in the same transaction as the movement; `lib/stock/backfill.ts` writes its reconstructed ones. Nothing outside `lib/stock/` writes it.
