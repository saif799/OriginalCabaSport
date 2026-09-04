import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const shoeModels = pgTable("shoe_models", {
  id: uuid().primaryKey().defaultRandom(),
  modelName: varchar("model_name").notNull(),
  // Storefront pricing (DZD) — the base of the 3-level resolution chain.
  basePrice: integer("base_price").notNull().default(0),
  compareAtPrice: integer("compare_at_price"),
  // Discoverability flag only: an archived model and its variants drop out of
  // the storefront catalog and the admin pickers, but keep their stock, their
  // history and their public product URLs. Never touches Physical Quantity.
  archived: boolean("archived").notNull().default(false),
});

export const shoes = pgTable(
  "shoes",
  {
    id: varchar().primaryKey(),
    modelId: uuid("model_id")
      .notNull()
      .references(() => shoeModels.id),
    color: varchar("color").notNull(),
    // barcode moved to inventory (size-specific)
    // Optional colour-level overrides of the model's price. Null = inherit model.
    priceOverride: integer("price_override"),
    compareAtPriceOverride: integer("compare_at_price_override"),
    // See shoeModels.archived — same flag, colour-variant scope.
    archived: boolean("archived").notNull().default(false),
  },
  // Postgres indexes primary keys and unique constraints automatically but
  // never foreign keys. This one serves filtering Products by Shoe Model
  // (`inArray(shoes.modelId, ...)`), NOT the shoes -> shoe_models join — that
  // join probes the Shoe Model's primary key and was already indexed.
  (t) => [index("shoes_model_id_idx").on(t.modelId)],
);

export const ordersTable = pgTable("orders", {
  id: varchar("id").primaryKey(),
  reference: varchar("reference"),
  nom_client: varchar("nom_client").notNull(),
  telephone: varchar("telephone").notNull(),
  telephone_2: varchar("telephone_2"),
  adresse: varchar("adresse").notNull(),
  commune: varchar("commune").notNull(),
  code_wilaya: varchar("code_wilaya").notNull(),
  montant: varchar("montant").notNull(),
  remarque: varchar("remarque"),

  type: integer("type").notNull(),
  source: varchar("source").notNull().default("i"),
  // Which delivery company this order was sent to. Existing rows default to DHD.
  provider: varchar("provider").notNull().default("dhd"),
  // Set when the order was placed BY a borrower (from their page): the sale is
  // drawn from the borrower's held stock, so cancel/retour must also restore it.
  // Null for normal owner orders.
  borrowerId: uuid("borrower_id").references(() => borrower.id),
  stop_desk: integer("stop_desk").notNull(),
  statusId: uuid("status_id")
    .notNull()
    .references(() => stautsGroupsTable.id)
    .default("404332b3-998f-498f-a325-3e4ecf6c3bbb"),
  saif_paid: boolean("saif_paid").notNull().default(false),
  createdAt: date("created_at").notNull().defaultNow(),
  updatedAt: date("updated_at").notNull().defaultNow(),
});

export const shoeInventory = pgTable(
  "shoe_inventory",
  {
    id: uuid().primaryKey().defaultRandom(),
    shoeId: varchar("shoe_id")
      .notNull()
      .references(() => shoes.id),
    size: varchar("size").notNull(),
    quantity: integer("quantity").notNull().default(0),
    // Optional size-specific price override (DZD). Null = use shoe basePrice.
    priceOverride: integer("price_override"),
    createdAt: date("created_at").notNull().defaultNow(),
  },
  // Postgres does not index foreign keys. Without this, reading one Product's
  // size rows sequentially scans every size row in the catalog — which is what
  // both the product page and every catalog card do.
  (t) => [index("shoe_inventory_shoe_id_idx").on(t.shoeId)],
);

export const LendedShoes = pgTable("lended_shoes", {
  id: uuid().primaryKey().defaultRandom(),
  shoeInventoryId: uuid("shoe_inventory_id")
    .notNull()
    .references(() => shoeInventory.id),
  borrowerId: uuid("borrower_id")
    .notNull()
    .references(() => borrower.id),
  quantity: integer("quantity").notNull().default(0),
  createdAt: date("created_at").notNull().defaultNow(),
});
export const borrower = pgTable("borrower", {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar("name").notNull(),
  createdAt: date("created_at").notNull().defaultNow(),
});

export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: varchar("order_id")
    .notNull()
    .references(() => ordersTable.id, { onDelete: "cascade" }),
  shoeInventoryId: uuid("shoe_inventory_id")
    .notNull()
    .references(() => shoeInventory.id),
  quantity: integer("quantity").notNull().default(1),
  createdAt: date("created_at").notNull().defaultNow(),
});

export const stautsGroupsTable = pgTable("status_groups_table", {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar("status_name").notNull(),

  external_statuses: varchar("external_statuses")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
});

export const ImageNotifierTable = pgTable("image_notifier_table", {
  id: uuid().primaryKey().defaultRandom(),
  shoeInventoryId: uuid("shoe_inventory_id")
    .notNull()
    .references(() => shoeInventory.id),
  orderId: varchar("order_id").references(() => ordersTable.id),
  // 'remove'  -> variant went out of stock, remove its photo from the gallery
  // 'restock' -> variant came back in stock, add its photo back
  direction: varchar("direction").notNull().default("remove"),
  createdAt: date("created_at").notNull().defaultNow(),
});

// NOTE: owner<->borrower rebalancing (bring-back / give-some) is computed live in
// GET /api/rebalance from shoe_inventory + lended_shoes — no stored table.

export const storeSales = pgTable("store_sales", {
  id: uuid().primaryKey().defaultRandom(),
  shoeInventoryId: uuid("shoe_inventory_id")
    .notNull()
    .references(() => shoeInventory.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// An "arrivage": a shipment/batch of shoes received together.
export const arrivals = pgTable("arrivals", {
  id: uuid().primaryKey().defaultRandom(),
  reference: varchar("reference"), // optional free-text label
  note: varchar("note"), // optional (supplier / invoice / remark)
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// One line per variant received in an arrivage. `quantity` is an immutable
// snapshot of how many pairs of that variant arrived in THIS shipment, so the
// history stays accurate even as live shoeInventory.quantity changes later.
export const arrivalItems = pgTable("arrival_items", {
  id: uuid().primaryKey().defaultRandom(),
  arrivalId: uuid("arrival_id")
    .notNull()
    .references(() => arrivals.id, { onDelete: "cascade" }),
  shoeInventoryId: uuid("shoe_inventory_id")
    .notNull()
    .references(() => shoeInventory.id),
  quantity: integer("quantity").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Delivery coverage tables — replaces communes.json, wilayas.json,
// tarifs.json, and yalidinCommunes_withExpressDesk.json.
//
// DHD and Yalidine cover DIFFERENT sets of wilayas, so each provider has its
// own wilaya table. The form dropdown shows only the wilayas the selected
// provider actually covers.
// ─────────────────────────────────────────────────────────────────────────────

/** DHD-covered wilayas (populated from GET /api/v1/get/wilayas). */
export const dhdWilayas = pgTable("dhd_wilayas", {
  wilayaId: integer("wilaya_id").primaryKey(), // official DZ code 1-58
  name: varchar("name").notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
});

/** DHD communes per wilaya (populated from GET /api/v1/get/communes). */
export const dhdCommunes = pgTable(
  "dhd_communes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wilayaId: integer("wilaya_id")
      .notNull()
      .references(() => dhdWilayas.wilayaId, { onDelete: "cascade" }),
    nom: varchar("nom").notNull(),
    hasStopDesk: integer("has_stop_desk").notNull().default(0),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
  },
  (t) => [unique("dhd_communes_wilaya_nom_unique").on(t.wilayaId, t.nom)],
);

/**
 * DHD tarifs per wilaya (populated from GET /api/v1/get/fees).
 * Stores livraison and echange prices (domicile + stop-desk).
 */
export const dhdTarifs = pgTable("dhd_tarifs", {
  wilayaId: integer("wilaya_id")
    .primaryKey()
    .references(() => dhdWilayas.wilayaId, { onDelete: "cascade" }),
  tarifLivraison: varchar("tarif_livraison").notNull().default("0"),
  tarifStopdeskLivraison: varchar("tarif_stopdesk_livraison")
    .notNull()
    .default("0"),
  tarifEchange: varchar("tarif_echange").notNull().default("0"),
  tarifStopdeskEchange: varchar("tarif_stopdesk_echange")
    .notNull()
    .default("0"),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
});

/** Yalidine-covered wilayas (derived from GET /v1/communes wilaya_id values). */
export const yalidineWilayas = pgTable("yalidine_wilayas", {
  wilayaId: integer("wilaya_id").primaryKey(), // official DZ code, Yalidine coverage
  name: varchar("name").notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
});

/**
 * Yalidine communes (populated from GET /v1/communes + enriched by GET /centers/).
 * commune_id is Yalidine's own stable id — used as natural PK for upserts.
 * stopdesk_id is the center_id from the Centers endpoint (NOT the express_desk fee).
 * express_desk is the stop-desk delivery price shown as a label in the order form.
 */
export const yalidineCommunes = pgTable("yalidine_communes", {
  communeId: integer("commune_id").primaryKey(), // Yalidine's own id (e.g. 101)
  wilayaId: integer("wilaya_id")
    .notNull()
    .references(() => yalidineWilayas.wilayaId, { onDelete: "cascade" }),
  name: varchar("name").notNull(),
  wilayaName: varchar("wilaya_name").notNull(),
  hasStopDesk: integer("has_stop_desk").notNull().default(0),
  isDeliverable: integer("is_deliverable").notNull().default(1),
  expressDesk: integer("express_desk"), // stop-desk delivery price (DA)
  stopdeskId: integer("stopdesk_id"),   // Yalidine center_id for parcel creation
  syncedAt: timestamp("synced_at", { withTimezone: true }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Storefront: shoe image gallery stored in Cloudflare R2.
// Each row represents one uploaded image for a shoe color variant (shoeId).
// ─────────────────────────────────────────────────────────────────────────────
export const shoeImages = pgTable(
  "shoe_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shoeId: varchar("shoe_id")
      .notNull()
      .references(() => shoes.id, { onDelete: "cascade" }),
    /** R2 object key (e.g. products/shoes/<shoeId>/<uuid>-filename.jpg) */
    cloudflareImageId: varchar("cloudflare_image_id").notNull(),
    /** Cached public CDN URL */
    url: varchar("url").notNull(),
    /** Accessibility / SEO alt text */
    altText: varchar("alt_text"),
    /** Integer sequence for carousel display order */
    sortOrder: integer("sort_order").notNull().default(0),
    /** Whether this is the hero thumbnail shown on catalog cards */
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Postgres does not index foreign keys. Without this, reading one Product's
  // Shoe Image Gallery sequentially scans the whole table — on every product
  // page and every catalog card.
  (t) => [index("shoe_images_shoe_id_idx").on(t.shoeId)],
);

// ─────────────────────────────────────────────────────────────────────────────
// Storefront: admin-curated Collections ("Suggestions", "Offres", "Ja Morant").
// Curation, not classification — a hand-picked, ordered set of colour variants
// with an image, a slug and a public page at /[lng]/collection/<slug>. The
// homepage is the grid of these; the hero itself is static, so there is no
// hero table. See ADR-0006.
// ─────────────────────────────────────────────────────────────────────────────
export const storefrontCollections = pgTable("storefront_collections", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title").notNull(),
  subtitle: varchar("subtitle"),
  /**
   * Public API. Derived from the title on creation, then fixed — renaming the
   * title must never touch it, or every link already shared 404s.
   */
  slug: varchar("slug").notNull().unique(),
  /**
   * R2 object key, the single source of truth for the image, exactly as
   * `shoeImages.cloudflareImageId` is. Nullable: a Collection can be parked
   * half-finished (an *Incomplete* Collection), it simply never renders.
   */
  imageKey: varchar("image_key"),
  /** Cached public CDN URL, always derived server-side via buildR2PublicUrl. */
  imageUrl: varchar("image_url"),
  /** Accessibility / SEO alt text; falls back to the title at render time. */
  imageAlt: varchar("image_alt"),
  sortOrder: integer("sort_order").notNull().default(0),
  isVisible: boolean("is_visible").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storefrontCollectionItems = pgTable(
  "storefront_collection_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => storefrontCollections.id, { onDelete: "cascade" }),
    shoeId: varchar("shoe_id")
      .notNull()
      .references(() => shoes.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("storefront_collection_items_collection_shoe_unique").on(t.collectionId, t.shoeId),
  ],
);
