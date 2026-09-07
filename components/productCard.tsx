"use client";

import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import SendOrderForm from "./sendShoeOrder";
import EditInventoryDialog from "./EditInventoryDialog";
import StoreSaleDialog from "./StoreSaleDialog";
import InventoryTransferDialog, {
  type TransferLine,
} from "./InventoryTransferDialog";
import { GroupedProduct } from "@/app/admin/(admin)/page";
import { Button, buttonVariants } from "./ui/button";
import {
  Handshake,
  ImageIcon,
  MoreHorizontal,
  Package,
  Pencil,
  ShoppingCart,
  Undo2,
} from "lucide-react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { storeHeldStock } from "@/lib/stock/availability";

interface ProductCardProps {
  product: GroupedProduct;
  selectedShoes?: Array<{ id: string }>;
  selectshoe: (id: string, identifier: string) => void;
  /**
   * Whether the surrounding list is in select mode. When false the card is not
   * a toggle at all — no click handler, no pressed state, no ring — so a tap on
   * a phone (where the select checkbox is hidden) never claims to do something
   * it does not do.
   */
  selectEnabled?: boolean;
  borrowerName?: string;
}

function numericSizeCompare(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b);
}
export default function ProductCard({
  product: {
    modelId,
    modelName,
    color,
    sizes,
    shoeId,
    archived,
    primaryImageUrl,
  },
  selectedShoes,
  selectshoe,
  selectEnabled = false,
  borrowerName,
}: ProductCardProps) {
  const router = useRouter();
  const params = useParams<{ lenderId?: string }>();
  const lenderId = params?.lenderId;
  const isBorrowerView = Boolean(lenderId);
  const [isOrderOpen, setIsOrderOpen] = useState(false);
  const [isStoreSaleOpen, setIsStoreSaleOpen] = useState(false);
  const [isEditInventoryOpen, setIsEditInventoryOpen] = useState(false);
  const [isLendInventoryOpen, setIsLendInventoryOpen] = useState(false);
  const [isBringBackOpen, setIsBringBackOpen] = useState(false);
  const [lendLines, setLendLines] = useState<TransferLine[]>([]);

  // Lendable qty per size accounts for stock already lent elsewhere, so it
  // has to be fetched fresh each time the lend dialog opens.
  useEffect(() => {
    if (!isLendInventoryOpen) return;
    let ignore = false;
    const inventoryIds = sizes.map((s) => s.inventoryId).join(",");
    if (!inventoryIds) return;

    fetch(`/api/lended-shoes?inventoryIds=${encodeURIComponent(inventoryIds)}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: { inventoryId: string; lentQuantity: number }[]) => {
        if (ignore) return;
        const lentById = new Map(
          data.map((r) => [r.inventoryId, Number(r.lentQuantity)]),
        );
        setLendLines(
          sizes
            .map((s) => {
              const lent = lentById.get(s.inventoryId) ?? 0;
              const lendable = storeHeldStock(s.quantity, lent);
              return {
                inventoryId: s.inventoryId,
                modelName,
                color,
                size: s.size,
                maxQty: lendable,
                helperText:
                  lent > 0
                    ? `${lendable} lendable · ${lent} already lent`
                    : `${lendable} in stock`,
              };
            })
            .filter((line) => line.maxQty > 0),
        );
      })
      .catch(() => {
        if (!ignore) setLendLines([]);
      });

    return () => {
      ignore = true;
    };
  }, [isLendInventoryOpen, sizes, modelName, color]);

  const bringBackLines: TransferLine[] = sizes
    .map((s) => ({
      inventoryId: s.inventoryId,
      modelName,
      color,
      size: s.size,
      maxQty: s.quantity,
      helperText: `${s.quantity} held`,
    }))
    .sort((a, b) => numericSizeCompare(a.size, b.size));

  const sortedSizes = [...sizes].sort((a, b) =>
    numericSizeCompare(a.size, b.size),
  );
  const totalPairs = sizes.reduce((total, s) => total + s.quantity, 0);
  const isSelected = selectedShoes?.some((shoe) => shoe.id === shoeId) ?? false;

  return (
    <article
      onClick={
        selectEnabled
          ? () => selectshoe(shoeId, modelName + color + sizes[0].size)
          : undefined
      }
      aria-pressed={selectEnabled ? (isSelected ? "true" : "false") : undefined}
      className={cn(
        "flex w-full min-w-0 items-start gap-3 overflow-hidden rounded-lg border border-gray-200 bg-white p-3 text-left shadow-sm transition hover:shadow-md focus:outline-none",
        archived && "opacity-60",
        selectEnabled && "cursor-pointer",
        // show a visible ring when selected
        selectEnabled && isSelected
          ? "ring-2 ring-purple-500/50 ring-offset-2"
          : "",
      )}
    >
      <Link
        href={`/admin/products/${shoeId}/edit`}
        onClick={(e) => e.stopPropagation()}
        className="size-16 shrink-0 overflow-hidden rounded-md border border-gray-200 sm:size-20"
      >
        {primaryImageUrl ? (
          // Plain <img> on purpose. `primaryImageUrl` is the 800px Rendition
          // (ADR-0007), which is already the right order of magnitude for a
          // 64-80px admin thumbnail, and this list renders dozens of them —
          // next/image would add a srcset apparatus for one fixed size.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={primaryImageUrl}
            alt={`${modelName} ${color}`}
            className="size-full object-cover"
          />
        ) : (
          <span className="flex size-full items-center justify-center bg-gray-100 text-gray-400">
            <ImageIcon className="size-5" />
            <span className="sr-only">Add a photo</span>
          </span>
        )}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-2 self-stretch">
        <div className="flex items-start gap-2">
          <h4 className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">
            {modelName}
          </h4>
          <span
            title={`${totalPairs} pairs`}
            className="shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-medium tabular-nums text-gray-700"
          >
            {totalPairs}
            <span className="sr-only"> pairs in stock</span>
          </span>
          {archived && (
            <span className="shrink-0 rounded border border-gray-300 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
              archivé
            </span>
          )}
        </div>

        <p className="truncate text-sm font-medium text-gray-800">{color}</p>

        <ul className="flex flex-wrap gap-1">
          {sortedSizes.map((s) => (
            <li
              key={s.inventoryId}
              className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium tabular-nums whitespace-nowrap text-gray-700"
            >
              {s.size}
            </li>
          ))}
        </ul>

        <div className="mt-auto flex items-center justify-end gap-2">
          <Dialog open={isOrderOpen} onOpenChange={setIsOrderOpen}>
            <DialogTrigger
              onClick={(e) => e.stopPropagation()}
              className={buttonVariants({
                variant: "outline",
                className: "flex items-center",
                size: "icon",
              })}
            >
              <Package className="h-3 w-3" />
              <span className="sr-only">Add an order</span>
            </DialogTrigger>
            <DialogContent
              className="w-full max-w-full sm:max-w-xl transition-all duration-300 max-h-[80vh] overflow-y-auto overflow-x-hidden px-2 md:p-6"
              style={{ boxSizing: "border-box" }}
            >
              <DialogHeader>
                <DialogTitle>add an Order</DialogTitle>
                <DialogDescription>
                  {isBorrowerView
                    ? "Order from this borrower's stock (defaults to Yalidine)"
                    : "enter the client info"}
                </DialogDescription>
              </DialogHeader>
              <div className="w-full">
                <SendOrderForm
                  shoe={{ shoeId, modelId, modelName, color, sizes }}
                  borrowerId={isBorrowerView ? lenderId : undefined}
                  // Close on success and refresh: the card's size chips and
                  // pair count are now one pair stale.
                  onSuccess={() => {
                    setIsOrderOpen(false);
                    router.refresh();
                  }}
                />
              </div>
            </DialogContent>
          </Dialog>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              {isBorrowerView && lenderId ? (
                <DropdownMenuItem onClick={() => setIsBringBackOpen(true)}>
                  <Dialog
                    open={isBringBackOpen}
                    onOpenChange={setIsBringBackOpen}
                  >
                    <DialogTrigger
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1"
                    >
                      <Undo2 className="h-3 w-3" /> Bring Back
                    </DialogTrigger>
                    <InventoryTransferDialog
                      open={isBringBackOpen}
                      onOpenChange={setIsBringBackOpen}
                      lines={bringBackLines}
                      target={{
                        mode: "return",
                        borrowerId: lenderId,
                        borrowerName: borrowerName ?? "this borrower",
                      }}
                      onSuccess={() => router.refresh()}
                    />
                  </Dialog>
                </DropdownMenuItem>
              ) : (
                <>
                  <DropdownMenuItem onClick={() => setIsStoreSaleOpen(true)}>
                    <Dialog
                      open={isStoreSaleOpen}
                      onOpenChange={setIsStoreSaleOpen}
                    >
                      <DialogTrigger
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1"
                      >
                        <ShoppingCart className="h-3 w-3 " /> Store Sale
                      </DialogTrigger>
                      <StoreSaleDialog
                        product={{
                          modelId,
                          modelName,
                          color,
                          sizes,
                          shoeId,
                        }}
                        setIsStoreSaleOpen={setIsStoreSaleOpen}
                      />
                    </Dialog>{" "}
                  </DropdownMenuItem>

                  <DropdownMenuItem onClick={() => setIsLendInventoryOpen(true)}>
                    <Dialog
                      open={isLendInventoryOpen}
                      onOpenChange={setIsLendInventoryOpen}
                    >
                      <DialogTrigger
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1"
                      >
                        <Handshake className="h-3 w-3" /> Lend
                      </DialogTrigger>
                      <InventoryTransferDialog
                        open={isLendInventoryOpen}
                        onOpenChange={setIsLendInventoryOpen}
                        lines={lendLines}
                        target={{ mode: "lend" }}
                        emptyText="No available sizes in stock."
                        onSuccess={() => router.refresh()}
                      />
                    </Dialog>
                  </DropdownMenuItem>

                  <DropdownMenuItem>
                    <Dialog
                      open={isEditInventoryOpen}
                      onOpenChange={setIsEditInventoryOpen}
                    >
                      <DialogTrigger
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1"
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </DialogTrigger>
                      <EditInventoryDialog
                        product={{
                          modelId,
                          modelName,
                          color,
                          sizes,
                          shoeId,
                        }}
                        setIsEditInventoryOpen={setIsEditInventoryOpen}
                      />
                    </Dialog>
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <a
                      href={`/admin/products/${shoeId}/edit`}
                      className="flex items-center gap-1 cursor-pointer"
                    >
                      <Package className="h-3 w-3" /> Edit Product (Pricing
                      &amp; Images)
                    </a>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </article>
  );
}
