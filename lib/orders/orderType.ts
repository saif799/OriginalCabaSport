/**
 * `ordersTable.type` of an Échange (ADR-0009). Every other order is `1`, a
 * Livraison. Its own module, free of server imports, because the orders table
 * — a client component — badges Échanges by it.
 */
export const ECHANGE_TYPE = 2;
