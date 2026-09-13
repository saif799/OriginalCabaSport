"use client";

import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_DELIVERY_MESSAGE,
  buildWhatsAppLink,
  renderDeliveryMessage,
} from "@/lib/orders/whatsappMessage";
import type { OrderType } from "./columns";

/**
 * The preview-and-send dialog behind the orders row action.
 *
 * Two things about it are load-bearing and easy to undo by accident:
 *
 * 1. **Send is an `<a href>`, not a click handler.** On a phone, opening
 *    WhatsApp is only permitted inside the tap that asked for it. Routing the
 *    send through `onClick` — even to `await` the bookkeeping first — pushes
 *    the open outside that gesture, and iOS Safari and Chrome mobile block it
 *    silently: you tap Send and nothing happens, with no error to see.
 * 2. **The sent-stamp is fired, not awaited**, for the same reason. It is
 *    bookkeeping; the message is the point. A failed stamp costs a missing
 *    badge, and the button works either way.
 *
 * The textarea holds the *rendered* message, not the template, so what is on
 * screen is exactly what WhatsApp receives. Saving it back as the default
 * therefore has to un-render the price — see `templateFrom`.
 */

type Props = {
  order: OrderType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the send has been handed to WhatsApp, so the table can refresh. */
  onSent: () => void;
};

/**
 * The edited text turned back into a template: the rendered price becomes
 * `{price}` again.
 *
 * Without this, ticking "save as default" on the first order would bake *that
 * customer's* amount into every later message — the one failure where the
 * message is well-formed, plausible, and wrong.
 *
 * Every occurrence is replaced, not just the first: the amount appearing twice
 * means the admin wrote it twice, and both should follow the next customer's
 * price rather than one of them freezing. The match is the exact string this
 * dialog rendered, so a number that is merely similar is left alone.
 */
function templateFrom(rendered: string, price: string): string {
  if (!price) return rendered;
  return rendered.split(price).join("{price}");
}

export function WhatsAppMessageDialog({
  order,
  open,
  onOpenChange,
  onSent,
}: Props) {
  const [template, setTemplate] = useState(DEFAULT_DELIVERY_MESSAGE);
  const [message, setMessage] = useState("");
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [loading, setLoading] = useState(false);

  const price = renderDeliveryMessage("{price}", order.montant);
  // An order whose `montant` does not parse renders no price at all, so there
  // is no substring to turn back into `{price}` — saving from it would store a
  // template that has silently lost its only token. Sending is unaffected; it
  // is only redefining the global default from this row that is refused.
  const canSaveDefault = price !== "";
  // Null exactly when the order carries no dialable number, which is also the
  // only thing that makes this order unsendable — so it answers both questions.
  const href = buildWhatsAppLink(order.telephone, message);

  // Loaded when the dialog opens rather than with the page: the template is
  // wanted on the small fraction of page loads where the button is pressed.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setSaveAsDefault(false);
    setLoading(true);

    (async () => {
      let next = DEFAULT_DELIVERY_MESSAGE;
      try {
        const res = await fetch("/api/admin/settings/whatsapp-message");
        if (res.ok) {
          const data = await res.json();
          if (typeof data?.message === "string" && data.message) {
            next = data.message;
          }
        }
      } catch {
        // A template that failed to load falls back to the shipped default
        // rather than an empty box: the admin can still send, and the only
        // thing lost is a customisation they can see is missing.
      }
      if (cancelled) return;
      setTemplate(next);
      setMessage(renderDeliveryMessage(next, order.montant));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, order.montant]);

  const handleSend = () => {
    // Fired, never awaited — see the header. Both requests are best-effort and
    // the navigation carries on regardless.
    if (saveAsDefault && canSaveDefault) {
      const next = templateFrom(message, price);
      if (next !== template) {
        void fetch("/api/admin/settings/whatsapp-message", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: next }),
        }).catch(() => {});
      }
    }

    void fetch("/api/admin/orders/whatsapp-sent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: order.id }),
    }).catch(() => {});

    // Deferred out of the click handler on purpose. Closing the dialog
    // unmounts this very anchor, and tearing an element out of the DOM during
    // its own click can cancel the browser's default action — which here is the
    // whole feature. A macrotask puts the teardown after the navigation has
    // been handed off.
    window.setTimeout(() => {
      onOpenChange(false);
      onSent();
    }, 0);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send WhatsApp message</DialogTitle>
          <DialogDescription>
            {order.nom_client} — {order.telephone}
            {href ? null : " (no usable number)"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Textarea
            dir="rtl"
            rows={5}
            value={loading ? "" : message}
            disabled={loading}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={loading ? "Loading message…" : undefined}
            className="text-right"
          />

          <div className="flex items-center gap-2">
            <Checkbox
              id="save-whatsapp-default"
              checked={saveAsDefault && canSaveDefault}
              onCheckedChange={(checked) => setSaveAsDefault(checked === true)}
              disabled={loading || !canSaveDefault}
            />
            <Label
              htmlFor="save-whatsapp-default"
              className="text-muted-foreground text-sm font-normal"
            >
              {canSaveDefault
                ? "Save as the default message"
                : "Can't save as default — this order has no readable amount"}
            </Label>
          </div>

          {order.confirmationSentAt ? (
            <p className="text-muted-foreground text-xs">
              Already messaged{" "}
              {new Date(order.confirmationSentAt).toLocaleString()}.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {href && !loading ? (
            <Button asChild>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleSend}
              >
                <MessageCircle className="h-4 w-4" />
                Open WhatsApp
              </a>
            </Button>
          ) : (
            // No handler: a disabled button never fires click, so anything
            // hung here would be unreachable. The header's "(no usable
            // number)" is what explains the dead control.
            <Button disabled>
              <MessageCircle className="h-4 w-4" />
              Open WhatsApp
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
