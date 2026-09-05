"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCcw, Search } from "lucide-react";
import { toast } from "sonner";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { buildOrderColumns, type OrderType } from "./columns";
import type { DeliveryRecord } from "@/lib/orders/deliveryRecord";
import { useUrlParams } from "@/lib/hooks/useUrlParams";
import {
  ALL_STATUSES,
  DEFAULT_ORDER_SORT,
  serializeOrderSort,
  type OrderSort,
  type OrderSortField,
  type SortDirection,
} from "./params";

export type StatusOption = { id: string; name: string; count: number };

interface DataTableProps {
  data: OrderType[];
  statuses: StatusOption[];
  /** Rows matching the current filters, not the row count of this page. */
  total: number;
  page: number;
  pageCount: number;
  /** A status id, or ALL_STATUSES. */
  status: string;
  /** The status a bare /admin/orders means — the only one omitted from the URL. */
  defaultStatus: string;
  query: string;
  sort: OrderSort;
  /** Delivery Records by order id — ready-to-ship rows only. See columns.tsx. */
  deliveryRecords: Record<string, DeliveryRecord>;
}

export function DataTable({
  data,
  statuses,
  total,
  page,
  pageCount,
  status,
  defaultStatus,
  query,
  sort,
  deliveryRecords,
}: DataTableProps) {
  const router = useRouter();
  const { isPending, setParams } = useUrlParams();
  const [search, setSearch] = useState(query);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    // Nothing to push on mount or once our own update lands (the server value
    // catches up to the local one), so this only fires while typing.
    if (search === query) return;
    const timer = setTimeout(() => {
      setParams({ q: search || null, page: null }, "replace");
    }, 300);
    return () => clearTimeout(timer);
  }, [search, query, setParams]);

  const columns = useMemo(
    () =>
      buildOrderColumns({
        sort,
        onSort: (field: OrderSortField, direction: SortDirection) => {
          const next = { field, direction };
          const isDefault =
            field === DEFAULT_ORDER_SORT.field &&
            direction === DEFAULT_ORDER_SORT.direction;
          setParams({
            // Sorting back to the default drops the param rather than pinning
            // it, so the URL collapses to a bare /admin/orders again.
            sort: isDefault ? null : serializeOrderSort(next),
            page: null,
          });
        },
        onOrderDeleted: () => router.refresh(),
        deliveryRecords,
      }),
    [sort, setParams, router, deliveryRecords]
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    // Filtering, sorting and paging all resolve in SQL; the table only renders.
    manualPagination: true,
    manualFiltering: true,
    manualSorting: true,
    pageCount,
  });

  const syncStatuses = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch("/api/status", { method: "GET" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error || "Failed to update statuses");
      }
      // The route reports rows whose status actually moved — not every parcel
      // the couriers returned, which is most of the table on every sync.
      const updated = Number(body?.updatedCount ?? 0);
      toast.success(
        updated > 0
          ? `${updated} ${updated === 1 ? "order" : "orders"} updated`
          : "Already up to date"
      );
      router.refresh();
    } catch (error) {
      toast.error((error as Error).message || "Failed to update statuses");
    } finally {
      setIsSyncing(false);
    }
  };

  const isFiltered = status !== ALL_STATUSES || query !== "";

  // Passed to SelectValue as explicit children. Radix otherwise portals the
  // selected item's text in from SelectContent, which isn't mounted until the
  // menu is first opened — so the trigger paints blank on load.
  const selectedStatusLabel =
    status === ALL_STATUSES
      ? "All statuses"
      : (statuses.find((option) => option.id === status)?.name ?? "Status");

  return (
    <div>
      <div className="flex flex-col gap-2 py-4 md:flex-row md:items-center">
        <div className="m-auto flex items-center gap-2 md:m-0 md:w-auto">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search name, reference or phone..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="max-w-sm pl-8"
            />
          </div>
          <Button
            disabled={isSyncing}
            variant="outline"
            onClick={syncStatuses}
            title="Sync statuses with the delivery companies"
          >
            <RefreshCcw className={isSyncing ? "animate-spin" : ""} />
          </Button>
        </div>

        <div className="flex w-full items-center justify-center gap-2 md:ml-auto md:w-auto">
          <Select
            value={status}
            onValueChange={(value) => {
              // Only the default status is dropped from the URL. ALL_STATUSES
              // has to be written explicitly, or the server would read the
              // missing param as the default and put the queue straight back.
              setParams({
                status: value === defaultStatus ? null : value,
                page: null,
              });
            }}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Status">{selectedStatusLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Statuses</SelectLabel>
                <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
                {statuses.map((option) => (
                  <SelectItem value={option.id} key={option.id}>
                    {option.name} ({option.count})
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          {/* Rows stay put and dim while the next page streams in, rather than
              collapsing into a skeleton and shifting the page around. */}
          <TableBody
            className={cn(
              "transition-opacity",
              isPending && "pointer-events-none opacity-50"
            )}
          >
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-32 text-center"
                >
                  <p className="text-sm font-medium">No orders match.</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {query
                      ? `Nothing matching "${query}"`
                      : "Nothing in this status"}
                    {status !== ALL_STATUSES && query ? " in this status." : "."}
                  </p>
                  {isFiltered && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => {
                        setSearch("");
                        setParams({ status: ALL_STATUSES, q: null, page: null });
                      }}
                    >
                      Show all orders
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-end gap-3 py-4">
        <p className="text-sm text-muted-foreground">
          {total} {total === 1 ? "order" : "orders"}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setParams({ page: String(page - 1) })}
          disabled={page <= 1 || isPending}
        >
          Previous
        </Button>
        <p className="text-sm">
          Page {page} of {pageCount}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setParams({ page: String(page + 1) })}
          disabled={page >= pageCount || isPending}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
