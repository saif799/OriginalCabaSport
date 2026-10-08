import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq, inArray, sql } from "drizzle-orm";

import AdminPage from "@/components/admin/AdminPage";
import { Button } from "@/components/ui/button";
import { requireAdminPage } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { borrower, shoeInventory, shoeModels, shoes } from "@/lib/schema";
import {
  HISTORY_PAGE_SIZE,
  compareSizes,
  getHistorySummary,
  getMovementHistory,
  isIsoDay,
  type HistoryFilters as LedgerFilters,
} from "@/lib/stock/history";
import { HistoryFilters } from "./HistoryFilters";
import { HistoryTimeline } from "./HistoryTimeline";
import { ShoeMultiSelect } from "./ShoeMultiSelect";
import { SummaryStrip } from "./SummaryStrip";
import { parsePage } from "@/app/admin/(admin)/orders/params";
import {
  HISTORY_PATH,
  parseFamilies,
  parseList,
  type HistorySearchParams,
} from "./params";

export const dynamic = "force-dynamic";

/** The current URL with one param changed — what the pager links to. */
function withParam(params: HistorySearchParams, key: string, value: string | null) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) next.set(k, v);
  }
  if (value === null) next.delete(key);
  else next.set(key, value);
  const qs = next.toString();
  return qs ? `${HISTORY_PATH}?${qs}` : HISTORY_PATH;
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<HistorySearchParams>;
}) {
  await requireAdminPage();
  const params = await searchParams;

  const [catalog, borrowers] = await Promise.all([
    db
      .select({
        shoeId: shoes.id,
        modelId: shoes.modelId,
        modelName: shoeModels.modelName,
        color: shoes.color,
        archived: sql<boolean>`${shoes.archived} OR ${shoeModels.archived}`,
      })
      .from(shoes)
      .innerJoin(shoeModels, eq(shoes.modelId, shoeModels.id))
      .orderBy(asc(shoeModels.modelName), asc(shoes.color)),
    db
      .select({ id: borrower.id, name: borrower.name })
      .from(borrower)
      .orderBy(asc(borrower.name)),
  ]);

  // Ids from the URL are only trusted once they match a row: a stale or
  // hand-edited link drops what no longer exists instead of failing the query.
  const known = new Set(catalog.map((option) => option.shoeId));
  const shoeIds = parseList(params.shoes).filter((id) => known.has(id));
  const borrowerId = borrowers.find((b) => b.id === params.borrower)?.id ?? null;
  const from = isIsoDay(params.from) ? params.from : "";
  const to = isIsoDay(params.to) ? params.to : "";
  const families = parseFamilies(params.families);
  const sizes = parseList(params.sizes);
  const page = parsePage(params.page);

  const picker = <ShoeMultiSelect options={catalog} selected={shoeIds} />;

  if (shoeIds.length === 0) {
    return (
      <AdminPage
        title="Stock history"
        description="Everything that happened to a shoe: arrived, sold, lent, brought back, came back."
        width="wide"
      >
        {picker}
        <div className="mt-6 rounded-md border p-10 text-center">
          <p className="text-sm font-medium">Pick one or more shoes to read their history.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Search by model or colour. Several shoes share one timeline.
          </p>
        </div>
      </AdminPage>
    );
  }

  const filters: LedgerFilters = { shoeIds, sizes, families, borrowerId, from, to, page };

  const [{ events, total }, summaries, sizeRows] = await Promise.all([
    getMovementHistory(filters),
    getHistorySummary(filters),
    db
      .selectDistinct({ size: shoeInventory.size })
      .from(shoeInventory)
      .where(inArray(shoeInventory.shoeId, shoeIds)),
  ]);

  // A page past the end — a narrowed filter, a stale link — goes back to the start.
  if (events.length === 0 && page > 1) redirect(withParam(params, "page", null));

  const pageCount = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  const isFiltered =
    families.length > 0 || sizes.length > 0 || !!borrowerId || !!from || !!to;

  return (
    <AdminPage
      title="Stock history"
      description="Everything that happened to a shoe: arrived, sold, lent, brought back, came back."
      width="wide"
    >
      <div className="flex flex-col gap-4">
        {picker}

        <SummaryStrip
          summaries={summaries}
          filtered={sizes.length > 0 || !!borrowerId || !!from || !!to}
        />

        <HistoryFilters
          families={families}
          sizes={sizes}
          availableSizes={sizeRows.map((row) => row.size).sort(compareSizes)}
          borrowers={borrowers}
          borrowerId={borrowerId}
          from={from}
          to={to}
        />

        {events.length > 0 ? (
          <HistoryTimeline events={events} />
        ) : (
          <div className="rounded-md border p-10 text-center">
            <p className="text-sm font-medium">
              {isFiltered ? "Nothing matches these filters." : "Nothing recorded yet."}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {isFiltered
                ? "Widen the dates or clear a filter."
                : "The history starts with the first arrivage, sale or lend it can find for these shoes."}
            </p>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{total}</span> event
            {total === 1 ? "" : "s"}
          </p>
          {pageCount > 1 && (
            <div className="flex items-center gap-3">
              {page > 1 ? (
                <Button variant="outline" size="sm" asChild>
                  <Link
                    href={withParam(params, "page", page > 2 ? String(page - 1) : null)}
                    scroll={false}
                  >
                    Newer
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  Newer
                </Button>
              )}
              <p className="text-sm">
                Page {page} of {pageCount}
              </p>
              {page < pageCount ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={withParam(params, "page", String(page + 1))} scroll={false}>
                    Older
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  Older
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </AdminPage>
  );
}
