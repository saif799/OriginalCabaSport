"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Map, MapPin, House } from "lucide-react";
import wilayas from "@/wilayas.json";
import { InferSelectModel } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";

import { DataTableColumnHeader } from "./data-table-column-header";
import { ordersTable } from "@/lib/schema";
import { READY_TO_SHIP_STATUS_NAME } from "@/lib/orders/status";
import type { DeliveryRecord } from "@/lib/orders/deliveryRecord";
import type { OrderSort, OrderSortField, SortDirection } from "./params";
import { OrderRowActions } from "./OrderRowActions";
import { DeliveryRecordBadge } from "./DeliveryRecordBadge";

export type OrderType = InferSelectModel<typeof ordersTable> & {
  statusName: string | null;
};

function formatDate(value: string | Date) {
  return new Date(value).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

type BuildColumnsOptions = {
  sort: OrderSort;
  onSort: (field: OrderSortField, direction: SortDirection) => void;
  /** Called after a row is deleted so the table can pull fresh server data. */
  onOrderDeleted: () => void;
  /**
   * Delivery Records by order id, resolved on the server. Only ready-to-ship
   * rows are ever present: the record answers "should I send this?", which a
   * delivered order has already answered. A missing id renders nothing.
   */
  deliveryRecords: Record<string, DeliveryRecord>;
};

/**
 * Built per-render rather than exported as a constant: sorting is URL state now,
 * so the headers need the live sort and the setter that writes it.
 */
export function buildOrderColumns({
  sort,
  onSort,
  onOrderDeleted,
  deliveryRecords,
}: BuildColumnsOptions): ColumnDef<OrderType>[] {
  return [
    {
      accessorKey: "nom_client",
      header: "Client Information",
      cell: ({ row }) => {
        // Sits under the phone number it was derived from, rather than in a
        // column of its own that would be empty on every non-queue row.
        const record = deliveryRecords[row.original.id];
        return (
          <>
            <div>{row.original.nom_client}</div>
            <div className="text-muted-foreground text-sm">
              {row.original.telephone}
            </div>
            {record ? <DeliveryRecordBadge record={record} /> : null}
          </>
        );
      },
    },
    {
      accessorKey: "adresse",
      header: "Adresse",
      cell: ({ row }) => {
        return (
          <>
            <div className="flex items-center gap-1">
              <Map size={14} />
              {
                wilayas.find(
                  (w) => w.wilaya_id === Number(row.original.code_wilaya)
                )?.wilaya_name
              }
            </div>
            <div className="flex items-center gap-1">
              <MapPin size={14} />
              {row.original.commune}
            </div>
            <div className="flex items-center gap-1">
              <House size={14} />
              {row.original.adresse}
            </div>
          </>
        );
      },
    },
    {
      accessorKey: "reference",
      header: "Reference",
    },
    {
      accessorKey: "createdAt",
      header: () => (
        <DataTableColumnHeader
          title="Date"
          field="createdAt"
          activeField={sort.field}
          activeDirection={sort.direction}
          onSort={onSort}
        />
      ),
      cell: ({ row }) => (
        <div className="whitespace-nowrap text-sm text-muted-foreground">
          {formatDate(row.original.createdAt)}
        </div>
      ),
    },
    {
      accessorKey: "montant",
      header: () => (
        <DataTableColumnHeader
          title="Price"
          field="montant"
          activeField={sort.field}
          activeDirection={sort.direction}
          onSort={onSort}
        />
      ),
      cell: ({ row }) => {
        return <div className="font-medium">{row.getValue("montant")} DA</div>;
      },
    },
    {
      accessorKey: "statusName",
      header: "Status",
      cell: ({ row }) => {
        const name = row.getValue("statusName") as string | null;
        return (
          <Badge
            variant={
              name === READY_TO_SHIP_STATUS_NAME ? "onDelivery" : "outline"
            }
          >
            {name ?? "Unknown"}
          </Badge>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <OrderRowActions order={row.original} onDeleted={onOrderDeleted} />
      ),
    },
  ];
}
