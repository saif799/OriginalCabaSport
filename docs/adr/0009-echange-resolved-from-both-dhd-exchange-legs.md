# ADR 0009: An Échange Is Resolved From Both DHD Exchange Legs, and Its Original Order Stays Delivered

## Status
Accepted

## Context
DHD records one Échange as two parcels (see CONTEXT.md "Exchange Legs"). At creation there is only the Échange's own tracking `T`. When the livreur makes the swap, DHD switches `T` to a return status — from then on it carries the Returned Pair back to us — and creates `T-EXCH`, marked delivered, for the Outgoing Pair. `T-EXCH` never appears in `get/orders`; only `get/trackings/info` returns it.

The status sync read only `T`, saw a return, and applied a `retour` movement to the Outgoing Pair. Every completed Échange therefore put the pair the customer kept back into stock and never added the pair they handed back, and counted the customer as having returned a parcel. Seven of the eight Échanges in the table on 2026-10-06 were damaged this way.

## Decision
- **A return status on `T` alone decides nothing for an Échange.** The sync asks `get/trackings/info` for `T-EXCH`. Delivered → the swap happened: the Échange is shown as delivered and the Returned Pairs re-enter stock through `applyMovement`. Absent → a Refused Échange, an ordinary `retour` of the Outgoing Pairs — but only once `T-EXCH` is still absent 24h after `T` was first seen returning, so a sync that lands between DHD's two writes cannot misread a swap as a refusal.
- **Every Échange is linked to the Original Order lines it returns**, and is started from that order. The link is what tells the sync which pair comes back; without it a delivered `T-EXCH` could only fix a status, never stock.
- **The Original Order stays delivered.** The swap is recorded as a link, not as a status change.
- **The Returned Pair re-enters stock when `T-EXCH` is delivered**, not when `T` physically reaches the store — the same moment an ordinary retour counts today.

## Considered Options
- **Flip the Original Order to `retour`.** The obvious reading of "the customer sent it back", rejected because the customer paid for it and accepted the parcel: it would remove its montant from revenue and count a return against the customer's Delivery Record, which is exactly the damage this ADR fixes on the other side.
- **Store `T` and `T-EXCH` as two order rows.** Rejected: every count of orders (analytics, the Delivery Record, the orders table) would see one Échange twice, and the tracking-number primary key would point at a parcel nobody created.
- **Restock when `T` reaches "Retours reçu".** Safer — the pair is not sellable while in transit — but it diverges from how every other retour counts and needs a second, later poll per Échange. Rejected for consistency.

## Consequences
- The status sync treats `type = 2` separately: it never applies the generic `retour` movement to an Échange, and stops overwriting a resolved Échange's status with `T`'s, since `T` keeps reporting return statuses for days after the swap.
- An Échange's montant is the price difference, so revenue for one pair is split across two delivered orders: the Original Order's full price plus the Échange's difference.
- Legacy Échanges (created before the link existed) get their status corrected but never a stock movement; their stock was reconciled by hand.
