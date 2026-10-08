"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { historyHref } from "@/app/admin/(admin)/history/params";

export type ArrivalSummary = {
  id: string;
  reference: string | null;
  note: string | null;
  createdAt: string | Date;
  variantCount: number;
  totalPairs: number;
};

type ArrivalItem = {
  id: string;
  received: number;
  inventoryId: string;
  size: string;
  currentStock: number;
  shoeId: string;
  color: string;
  modelName: string;
};

type ArrivalDetail = ArrivalSummary & { items: ArrivalItem[] };

function formatDateTime(value: string | Date) {
  return new Date(value).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ArrivalsList({ arrivals }: { arrivals: ArrivalSummary[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, ArrivalDetail>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const toggle = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!details[id]) {
      setLoadingId(id);
      try {
        const res = await fetch(`/api/arrivals/${id}`);
        if (res.ok) {
          const data: ArrivalDetail = await res.json();
          setDetails((prev) => ({ ...prev, [id]: data }));
        }
      } catch {
        // leave the row expanded with the loading/empty state
      } finally {
        setLoadingId(null);
      }
    }
  };

  if (arrivals.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center text-muted-foreground">
        No arrivages yet. Add shoes to record your first shipment.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <TableHead>Arrivage</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Variants</TableHead>
            <TableHead>Pairs</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {arrivals.map((a, index) => {
            const number = arrivals.length - index;
            const isOpen = expandedId === a.id;
            const detail = details[a.id];
            return (
              <Fragment key={a.id}>
                <TableRow
                  className="cursor-pointer"
                  onClick={() => toggle(a.id)}
                >
                  <TableCell>
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">
                      {a.reference || `Arrivage #${number}`}
                    </div>
                    {a.note && (
                      <div className="text-xs text-muted-foreground">
                        {a.note}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDateTime(a.createdAt)}
                  </TableCell>
                  <TableCell>{a.variantCount}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{a.totalPairs}</Badge>
                  </TableCell>
                </TableRow>

                {isOpen && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="bg-muted/30 p-0">
                      {loadingId === a.id && !detail ? (
                        <div className="p-4 text-sm text-muted-foreground">
                          Loading…
                        </div>
                      ) : detail && detail.items.length > 0 ? (
                        <div className="p-3">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Product</TableHead>
                                <TableHead>Size</TableHead>
                                <TableHead>Received</TableHead>
                                <TableHead>Current stock</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {detail.items.map((item) => (
                                <TableRow key={item.id}>
                                  <TableCell>
                                    <div className="flex items-center gap-2">
                                      {/* Into the stock history, with this colour picked. */}
                                      <Link
                                        href={historyHref({ shoeIds: [item.shoeId] })}
                                        className="min-w-0 hover:underline"
                                        title="See this shoe's stock history"
                                      >
                                        <div className="font-medium truncate">
                                          {item.modelName}
                                        </div>
                                        <div className="text-xs text-muted-foreground truncate">
                                          {item.color}
                                        </div>
                                      </Link>
                                    </div>
                                  </TableCell>
                                  <TableCell>{item.size}</TableCell>
                                  <TableCell>+{item.received}</TableCell>
                                  <TableCell>
                                    <Badge
                                      variant={
                                        item.currentStock === 0
                                          ? "destructive"
                                          : "outline"
                                      }
                                    >
                                      {item.currentStock} in stock
                                    </Badge>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <div className="p-4 text-sm text-muted-foreground">
                          No items in this arrivage.
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
