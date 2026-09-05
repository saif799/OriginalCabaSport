import { redirect } from "next/navigation";
import { and, asc, count, desc, eq, getTableColumns, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";

import AdminPage from "@/components/admin/AdminPage";
import { db } from "@/lib/db";
import {
  ordersTable,
  shoeInventory,
  shoeModels,
  shoes,
  stautsGroupsTable,
  storeSales,
} from "@/lib/schema";
import { READY_TO_SHIP_STATUS_ID } from "@/lib/orders/status";
import { canonicalPhone } from "@/lib/orders/phone";
import { getDeliveryRecordsByOrder } from "@/lib/orders/deliveryRecord";
import { OrdersTabs } from "./OrdersTabs";
import { DataTable, type StatusOption } from "./data-table";
import { StoreSalesTable } from "./StoreSalesTable";
import {
  ALL_STATUSES,
  PAGE_SIZE,
  parseDateMode,
  parseOrderSort,
  parsePage,
  type Tab,
} from "./params";

export const dynamic = "force-dynamic";

type OrdersSearchParams = {
  tab?: string;
  status?: string;
  q?: string;
  page?: string;
  sort?: string;
  date?: string;
  from?: string;
  to?: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Numeric value of the (varchar) montant column — same shape lib/analytics.ts uses. */
const MONTANT = sql`CAST(NULLIF(${ordersTable.montant}, '') AS NUMERIC)`;

/**
 * The filtered row count, carried on every row instead of a second COUNT query.
 * neon-http costs a round trip per statement, so folding it into the window
 * function halves the latency of a page change.
 */
const TOTAL = sql<number>`count(*) over()`.mapWith(Number);

/** The store runs on Algiers time; the server does not. "Today" has to mean the shop's today. */
const SHOP_TZ = "Africa/Algiers";
const localSaleDate = sql`(${storeSales.createdAt} AT TIME ZONE ${SHOP_TZ})::date`;

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Sends a page that ran off the end of the result set back to the last real
 * one — reachable after a delete or revert empties the final page.
 */
function clampPage(params: OrdersSearchParams, total: number): never {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) next.set(key, value);
  }
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (lastPage <= 1) next.delete("page");
  else next.set("page", String(lastPage));
  const qs = next.toString();
  redirect(qs ? `/admin/orders?${qs}` : "/admin/orders");
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<OrdersSearchParams>;
}) {
  const params = await searchParams;
  const tab: Tab = params.tab === "store" ? "store" : "online";
  const page = parsePage(params.page);
  const offset = (page - 1) * PAGE_SIZE;
  const query = params.q?.trim() ?? "";
  const searchPattern = query ? `%${escapeLikePattern(query)}%` : null;

  // Only the active tab queries — the other one isn't on screen.
  const body =
    tab === "store"
      ? await renderStoreSales({ params, page, offset, searchPattern, query })
      : await renderOnlineOrders({ params, page, offset, searchPattern, query });

  return (
    <AdminPage
      title="Orders"
      description={
        tab === "store"
          ? "Sales rung up in the shop."
          : "Parcels handed to a delivery company."
      }
      actions={<OrdersTabs activeTab={tab} />}
      width="wide"
    >
      {body}
    </AdminPage>
  );
}

type TabProps = {
  params: OrdersSearchParams;
  page: number;
  offset: number;
  searchPattern: string | null;
  query: string;
};

async function renderOnlineOrders({
  params,
  page,
  offset,
  searchPattern,
  query,
}: TabProps) {
  const sort = parseOrderSort(params.sort);

  // A bare /admin/orders is the ready-to-ship queue; ?status=all opts out.
  // Filtering keys off the id, never the name: names are admin-editable.
  const requestedStatus = params.status ?? READY_TO_SHIP_STATUS_ID;
  // A malformed status falls back to the queue rather than to every status —
  // the id goes straight into a SQL uuid comparison.
  const status =
    requestedStatus === ALL_STATUSES || UUID_RE.test(requestedStatus)
      ? requestedStatus
      : READY_TO_SHIP_STATUS_ID;

  // Stored numbers are canonical, so only the *query* needs normalising: typing
  // `+213 555 60 57 70` or `0555 60 57 70` should find the stored `0555605770`.
  // Still a contains match, so a partial number keeps working. Short queries are
  // skipped — a 1-2 digit fragment matches most of the table and would drown the
  // name search.
  const phoneQuery = canonicalPhone(query);
  const normalizedPhoneSearch =
    phoneQuery && phoneQuery.length >= 5
      ? ilike(ordersTable.telephone, `%${phoneQuery}%`)
      : undefined;

  const search = searchPattern
    ? or(
        ilike(ordersTable.nom_client, searchPattern),
        ilike(ordersTable.reference, searchPattern),
        ilike(ordersTable.telephone, searchPattern),
        normalizedPhoneSearch,
      )
    : undefined;

  const filters: (SQL | undefined)[] = [search];
  if (status !== ALL_STATUSES) {
    filters.push(eq(ordersTable.statusId, status));
  }
  const where = and(...filters);

  const sortExpression = sort.field === "montant" ? MONTANT : ordersTable.createdAt;
  const direction = sort.direction === "asc" ? asc : desc;

  const [rows, statusRows, statusCounts] = await Promise.all([
    // Joined so the table can render a readable status name instead of the raw
    // status_id, which survives a reseed that changes identifiers.
    db
      .select({
        ...getTableColumns(ordersTable),
        statusName: stautsGroupsTable.name,
        total: TOTAL,
      })
      .from(ordersTable)
      .leftJoin(stautsGroupsTable, eq(stautsGroupsTable.id, ordersTable.statusId))
      .where(where)
      // createdAt is a date, so ties are common — id breaks them so that
      // LIMIT/OFFSET paging can't repeat or skip a row between pages.
      .orderBy(direction(sortExpression), desc(ordersTable.id))
      .limit(PAGE_SIZE)
      .offset(offset),
    db
      .select({ id: stautsGroupsTable.id, name: stautsGroupsTable.name })
      .from(stautsGroupsTable),
    // Counts follow the search but ignore the status filter, so the dropdown
    // answers "what would I get if I switched to this status".
    db
      .select({ statusId: ordersTable.statusId, count: count() })
      .from(ordersTable)
      .where(search)
      .groupBy(ordersTable.statusId),
  ]);

  const total = rows[0]?.total ?? 0;

  if (rows.length === 0 && page > 1) {
    const [{ count: filteredTotal }] = await db
      .select({ count: count() })
      .from(ordersTable)
      .where(where);
    clampPage(params, filteredTotal);
  }

  const countByStatus = new Map(statusCounts.map((r) => [r.statusId, r.count]));
  const statuses: StatusOption[] = statusRows.map((row) => ({
    id: row.id,
    name: row.name,
    count: countByStatus.get(row.id) ?? 0,
  }));

  const orders = rows.map(({ total: _total, ...order }) => order);

  // The Delivery Record is a "should I send this?" signal, so it is resolved
  // only for the rows where that question is still open. On a page with none —
  // any other status filter — this costs no query at all.
  const deliveryRecords = await getDeliveryRecordsByOrder(
    orders.filter((order) => order.statusId === READY_TO_SHIP_STATUS_ID),
  );

  return (
    <DataTable
      data={orders}
      deliveryRecords={deliveryRecords}
      statuses={statuses}
      total={total}
      page={page}
      pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
      status={status}
      defaultStatus={READY_TO_SHIP_STATUS_ID}
      query={query}
      sort={sort}
    />
  );
}

async function renderStoreSales({
  params,
  page,
  offset,
  searchPattern,
  query,
}: TabProps) {
  const dateMode = parseDateMode(params.date);
  const from = params.from ?? "";
  const to = params.to ?? "";

  const filters: (SQL | undefined)[] = [
    searchPattern
      ? or(
          ilike(shoeModels.modelName, searchPattern),
          ilike(shoes.color, searchPattern),
        )
      : undefined,
  ];

  if (dateMode === "today") {
    filters.push(sql`${localSaleDate} = (now() AT TIME ZONE ${SHOP_TZ})::date`);
  } else if (dateMode === "custom") {
    // The date inputs are shop-local days, inclusive at both ends.
    if (from) filters.push(gte(localSaleDate, sql`${from}::date`));
    if (to) filters.push(lte(localSaleDate, sql`${to}::date`));
  }

  const where = and(...filters);

  const [rows, soldTodayRows] = await Promise.all([
    db
      .select({
        id: storeSales.id,
        createdAt: storeSales.createdAt,
        inventoryId: storeSales.shoeInventoryId,
        size: shoeInventory.size,
        quantity: shoeInventory.quantity,
        shoeId: shoes.id,
        color: shoes.color,
        modelName: shoeModels.modelName,
        total: TOTAL,
      })
      .from(storeSales)
      .innerJoin(shoeInventory, eq(storeSales.shoeInventoryId, shoeInventory.id))
      .innerJoin(shoes, eq(shoeInventory.shoeId, shoes.id))
      .innerJoin(shoeModels, eq(shoes.modelId, shoeModels.id))
      .where(where)
      .orderBy(desc(storeSales.createdAt), desc(storeSales.id))
      .limit(PAGE_SIZE)
      .offset(offset),
    db
      .select({ count: count() })
      .from(storeSales)
      .where(sql`${localSaleDate} = (now() AT TIME ZONE ${SHOP_TZ})::date`),
  ]);

  const total = rows[0]?.total ?? 0;

  if (rows.length === 0 && page > 1) {
    const [{ count: filteredTotal }] = await db
      .select({ count: count() })
      .from(storeSales)
      .innerJoin(shoeInventory, eq(storeSales.shoeInventoryId, shoeInventory.id))
      .innerJoin(shoes, eq(shoeInventory.shoeId, shoes.id))
      .innerJoin(shoeModels, eq(shoes.modelId, shoeModels.id))
      .where(where);
    clampPage(params, filteredTotal);
  }

  return (
    <StoreSalesTable
      data={rows.map(({ total: _total, ...row }) => row)}
      total={total}
      page={page}
      pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
      query={query}
      dateMode={dateMode}
      from={from}
      to={to}
      soldToday={soldTodayRows[0]?.count ?? 0}
    />
  );
}
