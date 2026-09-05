# Domain Glossary (CONTEXT.md)

Canonical terminology and concepts for the OCS Inventory & Storefront project.

## Storefront & Product Concepts

### Product (Storefront)
A public-facing item available for browsing and purchasing. Corresponds to a specific color variant of a model (a `shoes` record in the database, e.g., "Air Force 1 - Black"). A Product features its own Cloudflare R2 image gallery, pricing, and size availability.

### Shoe Model
A brand or style classification (e.g., "Air Force 1", "Yeezy 350"). Groups one or more color variants (`shoes`). On the storefront, switching colors navigates between products sharing the same Shoe Model.

### Shoe Image Gallery (`shoe_images`)
Collection of uploaded Cloudflare R2 image assets associated with a specific color variant (`shoeId`).
- **Primary Image (`isPrimary`)**: The designated hero thumbnail image used in product catalog cards and preview cards across the storefront.
- **Sort Order (`sortOrder`)**: Integer sequence determining the display order of thumbnails inside the product page carousel.

### Variant Pricing
The monetary price of a shoe item in Algerian Dinars (DZD / DA), resolved through three levels (see ADR-0002, superseding ADR-0001 §3):
- **Base Price (`shoeModels.basePrice`)**: The model's default price. Root of the resolution chain.
- **Compare-At Price (`shoeModels.compareAtPrice`)**: The model's original/list price, shown with strikethrough formatting during sales.
- **Price Override (`shoes.priceOverride` / `shoes.compareAtPriceOverride`)**: Optional colour-level overrides of the model's price/compare-at price.
- **Size Price Override (`shoeInventory.priceOverride`)**: An optional size-specific price adjustment that overrides the colour's price for particular sizes (e.g., rare or oversized pairs).
- Resolution order (highest priority first): size override → colour override → model base price. First non-null wins (`resolveProductPrice` / `resolveCompareAtPrice` in `lib/helpers.ts`).

### Out-of-Stock Size Guard
Mechanism disabling selection and submission for size variants whose `quantity` in `shoe_inventory` equals 0. Out-of-stock sizes display strikethrough styling and disabled interaction state.

### Collection
An admin-curated, ordered set of Products presented on the storefront as one browsable destination — "Suggestions", "Offres", "Ja Morant". A Collection is **curation, not classification**: its members are hand-picked one by one, a Product can belong to several Collections at once, and nothing about a Product determines which Collection it lands in. It carries a title, an optional subtitle, an image, and a Collection Slug. Collections are the homepage's only navigational content — the homepage is a grid of Collection cards, not a list of products (see ADR-0006).

A future taxonomy on Shoe Model (Basketball / Running) would be *classification* and is a different concept — do not call it a Collection.

### Collection Slug
The stable, human-readable public identifier a Collection is addressed by (`/collection/ja-morant`). Derived from the title when the Collection is created, then treated as fixed: changing it breaks every link already shared, so it is only editable through a deliberate unlock. Renaming a Collection's title does not change its Slug.

### Incomplete Collection
A Collection with no image. It cannot be rendered — the homepage card *is* the image — so it never reaches the storefront at all, and is flagged as such in admin. This is a draft state, not an error: it is what a Collection looks like between being created and having its photo uploaded.

### Hidden Collection
A Collection whose visibility has been switched off by the owner. It is absent from the homepage grid **and** its Slug stops resolving. Hidden means hidden — an intentionally parked Collection is not something to keep serving.

### Empty Collection
A Collection whose every pick is currently unpriced or out of stock, so nothing live remains to show. Distinct from Hidden: nobody switched it off, the stock ran out. Its card drops out of the homepage grid, but **its Slug keeps resolving**, showing an empty state and a route back to the catalog — a link shared to a story outlives the stock it pointed at.

### Storefront Filtering Tool
Catalog filtering mechanism adapting the admin `FilterTool` pattern:
- **Shoe Model Filter**: Filter catalog listings by one or more selected shoe models.
- **Size Filter**: Filter catalog listings by available numerical sizes (35.5 - 51.5).
- **Price Filter**: Filter catalog by minimum and maximum resolved price range (DZD).
- **Product Search**: Instant text search matching model and color names.

### Storefront Checkout
The public direct-purchase workflow allowing a customer to select an available size, enter contact and delivery details, and place an order. Restricted strictly to the DHD delivery provider with automated DHD wilaya/commune fee calculation.

### Order Confirmation
The post-checkout summary view presented to the customer upon successful order placement, displaying the unique order ID/reference, ordered item summary, delivery address, and total cost breakdown.

## Stock & Location

### Physical Quantity (`shoeInventory.quantity`)
Total units of one size-variant owned, wherever they physically sit — at the store or with a Borrower. This is what is sellable, and what the storefront, the admin listing and the Shoe Image Gallery flags all read. See ADR-0003.

### Storage Location
Where a unit of stock physically sits: the store itself, or a Borrower. A Borrower holding stock has not bought it — Physical Quantity is unaffected by where a unit sits.

### Store-Held Stock
Physical Quantity minus everything currently at a Borrower (`storeHeldStock` / `storeHeldStockSql` in `lib/stock/availability.ts`). Governs what can be handed to a Borrower and what `/admin/rebalance` chases. **Never** governs sellability — that's Physical Quantity's job alone. See ADR-0003.

### Holdings
The units of one size-variant currently at one Borrower's location, computed live as `SUM(lended_shoes.quantity)` for that borrower+variant. `lended_shoes` is an append-only ledger of *where a pair sits*, not a stored balance — lending inserts `+n`, returning inserts `-n`, and a borrower-placed sale inserts `-1`.

### Stock Movement
Any change to Physical Quantity or Storage Location, always carrying a reason (`sale`, `borrower-sale`, `cancel`, `retour`, `arrival`, `lend`, `return`, or `correction`). The single owner of every Stock Movement is `applyMovement` in `lib/stock/movement.ts` — see ADR-0004.

### Échange
An order `type` (`type = 2`) representing a customer exchange. Today it is handled identically to a `sale` on the outgoing side — it decrements stock like any other sale — and the incoming pair the customer sends back is reconciled by hand outside the system. The intended behaviour (decrement the outgoing variant, increment the incoming one, atomically) is **not implemented**. Tracked separately in [#13](https://github.com/saif799/inventory-system-ocs/issues/13) — do not conflate an Échange's stock effect with a `retour` when reading order-status code.

## Delivery & Coverage

### Delivery Mode
How a parcel reaches the customer: **home** (*à domicile* — the courier delivers to the address) or **desk** (*bureau* — the customer collects from a Stop Desk). Carried on the wire and in `ordersTable.stop_desk` as `0` = home, `1` = desk. Every order has exactly one Delivery Mode.

### Stop Desk
A courier-operated pickup office. Whether one serves a given Commune is a property of the Commune, not of the order — a Commune with no Stop Desk cannot take a `desk` order at all. Only a small minority of Communes have one.

### Coverage
The set of Communes a given Delivery Provider serves in a Wilaya, together with which Delivery Modes each Commune supports and at what price. Coverage is per-provider: the same Commune may be served by one courier and not another, and the couriers do not agree on Commune spellings. A Commune supporting *no* mode is not offerable and is never shown to a customer.

### Tarif
A Delivery Provider's price for one Delivery Mode, in integer DZD. **A desk Tarif of `0` means the mode is unavailable, never that it is free** — the two Wilayas priced that way are exactly the two containing no Stop Desk at all. A `0` Tarif and an unsupported mode are the same statement.

### Delivery Record
How every past order sharing one customer's phone number actually ended, read on the ready-to-ship queue to answer a single question: is this parcel worth sending? It counts only the two outcomes that cost money — a parcel that arrived, and a parcel that came back — and is a live reading of the order history, never a stored score.

Two exclusions are deliberate. A **Cancel does not count**: it was stopped before the parcel ever reached a courier, so it cost nothing, and counting it would condemn most repeat customers for something that never shipped. The **second phone number does not count**: it is the courier's fallback line, not the customer's identity, and two people sharing a household number would inherit each other's record. Orders still in flight have not resolved into anything and count as neither — which is also why the order being judged never counts towards its own record.

Customers are matched on the **national core** of their phone number, not on the number as typed. The same person appears in the table as `0555605770`, `0555 60 57 70` and `+213555605770`; these are one customer.

### Record State
The four verdicts a Delivery Record resolves to, read top-down so that the worst applicable one wins:
- **Poor** — more parcels came back than arrived.
- **Mixed** — as many came back as arrived, and at least one came back.
- **Clean** — more arrived than came back.
- **Unknown** — nothing has resolved either way. Distinct from a good record: a customer whose only past orders were cancelled or are still in flight has a history, but none of it says whether their parcels arrive. Unknown is shown as nothing at all, never as a verdict.

### Wilaya / Commune
The two administrative levels an Algerian delivery address resolves to: the Wilaya (province, numbered 1–58) and the Commune within it. A Delivery Provider need not cover every Wilaya. Fees are quoted per Wilaya by both couriers; Stop Desk availability varies per Commune.

## Access

### Admin Session
The state of being the signed-in owner. There is exactly one account — the owner — so a session carries no identity, only the fact that whoever holds it proved they know the admin password, and an expiry. Ending a session in one browser does not end it in another (see ADR-0005).

### Admin Surface
Everything that requires an Admin Session: the `/admin` dashboard and every API route except the Public API Surface. Closed by default — a route is part of the Admin Surface unless it has been explicitly named public.

### Public API Surface
The short, explicitly enumerated set of API requests a customer's browser is allowed to make without an Admin Session: submitting a checkout, looking up delivery Coverage, and the auth routes. Membership is per **request** (path *and* method), not per path — the same path can be public for one method and part of the Admin Surface for another.
