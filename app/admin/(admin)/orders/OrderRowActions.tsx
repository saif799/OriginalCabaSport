"use client";

import { useState } from "react";
import { MessageCircle, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EN_LIVRAISON_STATUS_ID } from "@/lib/orders/status";
import type { OrderType } from "./columns";
import { WhatsAppMessageDialog } from "./WhatsAppMessageDialog";

export function OrderRowActions({
  order,
  onDeleted,
  onMessaged,
}: {
  order: OrderType;
  onDeleted: () => void;
  /** Called after a row is messaged, so its badge appears. */
  onMessaged: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [whatsAppOpen, setWhatsAppOpen] = useState(false);

  // Offered only while the parcel is with the livreur. The message says it is
  // arriving imminently, which is false on every other status — and on the 444
  // delivered rows it would be sent to someone who already has their shoes.
  const canMessage = order.statusId === EN_LIVRAISON_STATUS_ID;

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch("/api/order", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || err?.error || "Failed to delete order");
      }
      setConfirmOpen(false);
      toast.success("Order deleted — stock restored");
      // A server refetch rather than a full reload: the page's list state lives
      // in the URL, so refreshing keeps the current filters, page and sort.
      onDeleted();
    } catch (error) {
      toast.error((error as Error).message || "Failed to delete order");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 w-8 p-0">
            <span className="sr-only">Open menu</span>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Actions</DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => navigator.clipboard.writeText(order.telephone)}
          >
            Copy Livreur Number
          </DropdownMenuItem>
          {canMessage ? (
            <DropdownMenuItem
              onSelect={(event) => {
                // Same reason as Delete below: let the menu close before the
                // dialog opens, or Radix fights over focus between the two.
                event.preventDefault();
                setWhatsAppOpen(true);
              }}
            >
              <MessageCircle className="h-4 w-4" />
              {order.confirmationSentAt
                ? "Send WhatsApp again"
                : "Send WhatsApp"}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={(event) => {
              // Let the menu close before the dialog opens, otherwise Radix
              // fights over focus between the two overlays.
              event.preventDefault();
              setConfirmOpen(true);
            }}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {canMessage ? (
        <WhatsAppMessageDialog
          order={order}
          open={whatsAppOpen}
          onOpenChange={setWhatsAppOpen}
          onSent={onMessaged}
        />
      ) : null}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this order?</AlertDialogTitle>
            <AlertDialogDescription>
              {order.nom_client} — {order.reference ?? order.id}. The parcel is
              cancelled with the carrier and its items go back into stock. This
              can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(event) => {
                // Keep the dialog mounted while the request is in flight.
                event.preventDefault();
                handleDelete();
              }}
            >
              {isDeleting ? "Deleting..." : "Delete order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
