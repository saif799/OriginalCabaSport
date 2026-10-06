"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronsUpDown, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDeliveryCoverage } from "@/lib/delivery/useDeliveryCoverage";
import { formatDA } from "@/lib/format";
import type { EchangeDraft, EchangeStart } from "@/lib/orders/echange";
import type { OrderType } from "./columns";

type Props = {
  /** The Original Order the Échange is started from. */
  order: OrderType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once DHD has the parcel, so the table can refresh. */
  onCreated: () => void;
};

type CustomerFields = Pick<
  EchangeDraft,
  | "nom_client"
  | "telephone"
  | "telephone_2"
  | "adresse"
  | "commune"
  | "code_wilaya"
  | "stop_desk"
  | "remarque"
>;

type OutgoingRow = { key: number; shoeId: string; inventoryId: string };

/**
 * Starts an Échange from a delivered order (ADR-0009): tick the pairs coming
 * back, pick the pairs going out, check the customer's details.
 *
 * The montant follows the price difference — `max(0, new − returned)` at
 * today's resolved prices, no delivery fee — until it is typed over. A cheaper
 * swap floors at 0; any refund is settled outside the app.
 *
 * Mount it only while open: it loads the Original Order's lines and the whole
 * in-stock catalogue, which is not worth doing for every delivered row.
 */
export function EchangeDialog({ order, open, onOpenChange, onCreated }: Props) {
  const [start, setStart] = useState<EchangeStart | null>(null);
  const [loadError, setLoadError] = useState("");
  /** Pairs coming back, per Original Order line. Absent or 0 = staying with the customer. */
  const [returns, setReturns] = useState<Record<string, number>>({});
  const [outgoing, setOutgoing] = useState<OutgoingRow[]>([]);
  const [nextKey, setNextKey] = useState(0);
  const [fields, setFields] = useState<CustomerFields>(() => ({
    nom_client: order.nom_client,
    telephone: order.telephone,
    telephone_2: order.telephone_2,
    adresse: order.adresse,
    commune: order.commune,
    code_wilaya: order.code_wilaya,
    stop_desk: order.stop_desk,
    remarque: null,
  }));
  /** Null while the montant still follows the price difference. */
  const [montant, setMontant] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  const { wilayas, communeNames } = useDeliveryCoverage(
    "dhd",
    fields.code_wilaya,
    fields.stop_desk === 1 ? 1 : 0,
  );

  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/orders/echange?orderId=${encodeURIComponent(order.id)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || "Failed to load the order");
        return body as EchangeStart;
      })
      .then((loaded) => alive && setStart(loaded))
      .catch((e: Error) => alive && setLoadError(e.message));
    return () => {
      alive = false;
    };
  }, [order.id]);

  const sizeByInventoryId = useMemo(() => {
    const map = new Map<string, EchangeStart["products"][number]["sizes"][number]>();
    for (const product of start?.products ?? []) {
      for (const size of product.sizes) map.set(size.inventoryId, size);
    }
    return map;
  }, [start]);

  const returnedTotal = (start?.lines ?? []).reduce(
    (sum, line) => sum + line.price * (returns[line.orderItemId] ?? 0),
    0,
  );
  const outgoingTotal = outgoing.reduce(
    (sum, row) => sum + (sizeByInventoryId.get(row.inventoryId)?.price ?? 0),
    0,
  );
  const suggestedMontant = Math.max(0, outgoingTotal - returnedTotal);
  const montantValue = montant ?? String(suggestedMontant);

  const returnCount = Object.values(returns).reduce((sum, q) => sum + q, 0);
  const canSubmit =
    !!start && returnCount > 0 && outgoing.length > 0 && !submitting;

  const patch = (next: Partial<CustomerFields>) =>
    setFields((prev) => ({ ...prev, ...next }));

  const addOutgoing = (product: EchangeStart["products"][number]) => {
    const size = product.sizes[0];
    if (!size) return;
    setOutgoing((prev) => [
      ...prev,
      { key: nextKey, shoeId: product.shoeId, inventoryId: size.inventoryId },
    ]);
    setNextKey((k) => k + 1);
  };

  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const draft: EchangeDraft = {
        ...fields,
        originalOrderId: order.id,
        returns: Object.entries(returns)
          .filter(([, quantity]) => quantity > 0)
          .map(([orderItemId, quantity]) => ({ orderItemId, quantity })),
        outgoing: outgoing.map((row) => row.inventoryId),
        montant: montantValue,
      };
      const res = await fetch("/api/admin/orders/echange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Failed to create the Échange");
      toast.success(`Échange created — ${body.orderId}`);
      onOpenChange(false);
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Échanger</DialogTitle>
          <DialogDescription>
            {order.nom_client} — {order.id}. Sent with DHD as an Échange; the
            pairs coming back return to stock once DHD confirms the swap.
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <p className="text-sm text-red-600">{loadError}</p>
        ) : !start ? (
          <p className="text-sm text-muted-foreground">Loading the order…</p>
        ) : (
          <div className="space-y-6">
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Coming back</h3>
              {start.lines.map((line) => {
                const quantity = returns[line.orderItemId] ?? 0;
                const id = `return-${line.orderItemId}`;
                return (
                  <div key={line.orderItemId} className="flex items-center gap-3">
                    <Checkbox
                      id={id}
                      checked={quantity > 0}
                      disabled={line.exchangeable === 0}
                      onCheckedChange={(checked) =>
                        setReturns((prev) => ({
                          ...prev,
                          [line.orderItemId]: checked ? 1 : 0,
                        }))
                      }
                    />
                    <Label htmlFor={id} className="flex-1 font-normal">
                      {line.label}
                      {line.exchangeable === 0 ? (
                        <span className="text-muted-foreground">
                          {" "}
                          — already exchanged
                        </span>
                      ) : null}
                    </Label>
                    {line.exchangeable > 1 && quantity > 0 ? (
                      <Input
                        type="number"
                        min={1}
                        max={line.exchangeable}
                        value={quantity}
                        onChange={(e) => {
                          const next = Math.min(
                            line.exchangeable,
                            Math.max(1, Math.floor(Number(e.target.value) || 1)),
                          );
                          setReturns((prev) => ({ ...prev, [line.orderItemId]: next }));
                        }}
                        className="w-20"
                        aria-label={`Pairs of ${line.label} coming back`}
                      />
                    ) : null}
                    <span className="w-28 text-right text-sm text-muted-foreground">
                      {formatDA(line.price)}
                    </span>
                  </div>
                );
              })}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-medium">Sending</h3>
              {outgoing.map((row) => {
                const product = start.products.find((p) => p.shoeId === row.shoeId);
                const size = sizeByInventoryId.get(row.inventoryId);
                return (
                  <div key={row.key} className="flex items-center gap-2">
                    <span className="flex-1 text-sm">{product?.label}</span>
                    <Select
                      value={row.inventoryId}
                      onValueChange={(inventoryId) =>
                        setOutgoing((prev) =>
                          prev.map((r) => (r.key === row.key ? { ...r, inventoryId } : r)),
                        )
                      }
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue>{size?.size}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {product?.sizes.map((s) => (
                          <SelectItem key={s.inventoryId} value={s.inventoryId}>
                            {s.size} ({s.quantity} left)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="w-28 text-right text-sm text-muted-foreground">
                      {size ? formatDA(size.price) : ""}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label="Remove"
                      onClick={() =>
                        setOutgoing((prev) => prev.filter((r) => r.key !== row.key))
                      }
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={pickerOpen}
                    className="w-full justify-between"
                  >
                    Add a pair to send
                    <ChevronsUpDown className="opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-(--radix-popover-trigger-width) p-0"
                >
                  <Command>
                    <CommandInput placeholder="Search model or colour..." className="h-9" />
                    <CommandList>
                      <CommandEmpty>Nothing in stock matches.</CommandEmpty>
                      <CommandGroup>
                        {start.products.map((product) => (
                          <CommandItem
                            key={product.shoeId}
                            value={product.label}
                            onSelect={() => {
                              setPickerOpen(false);
                              addOutgoing(product);
                            }}
                          >
                            {product.label}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </section>

            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="echange-nom">Client name</Label>
                <Input
                  id="echange-nom"
                  value={fields.nom_client}
                  onChange={(e) => patch({ nom_client: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="echange-tel">Phone</Label>
                <Input
                  id="echange-tel"
                  type="tel"
                  value={fields.telephone}
                  onChange={(e) => patch({ telephone: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="echange-tel2">Alternative phone</Label>
                <Input
                  id="echange-tel2"
                  type="tel"
                  value={fields.telephone_2 ?? ""}
                  onChange={(e) => patch({ telephone_2: e.target.value || null })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="echange-mode">Delivery type</Label>
                <Select
                  value={String(fields.stop_desk)}
                  onValueChange={(value) =>
                    patch({ stop_desk: Number(value), commune: "" })
                  }
                >
                  <SelectTrigger id="echange-mode" className="w-full">
                    <SelectValue>
                      {fields.stop_desk === 1 ? "bureau" : "a domicile"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">a domicile</SelectItem>
                    <SelectItem value="1">bureau</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="echange-wilaya">Wilaya</Label>
                <Select
                  value={fields.code_wilaya}
                  onValueChange={(value) => patch({ code_wilaya: value, commune: "" })}
                >
                  <SelectTrigger id="echange-wilaya" className="w-full">
                    <SelectValue placeholder="Select a wilaya...">
                      {fields.code_wilaya
                        ? `${fields.code_wilaya} - ${
                            wilayas.find((w) => String(w.wilayaId) === fields.code_wilaya)
                              ?.name ?? ""
                          }`
                        : undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {wilayas.map((w) => (
                      <SelectItem key={w.wilayaId} value={String(w.wilayaId)}>
                        {w.wilayaId} - {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="echange-commune">Commune</Label>
                <Select
                  value={fields.commune}
                  onValueChange={(value) => patch({ commune: value })}
                >
                  <SelectTrigger id="echange-commune" className="w-full">
                    <SelectValue placeholder="Select a commune...">
                      {fields.commune || undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {communeNames.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="echange-adresse">Address</Label>
                <Input
                  id="echange-adresse"
                  value={fields.adresse}
                  onChange={(e) => patch({ adresse: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="echange-montant">Montant</Label>
                  {montant !== null ? (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline"
                      onClick={() => setMontant(null)}
                    >
                      Use difference ({formatDA(suggestedMontant)})
                    </button>
                  ) : null}
                </div>
                <Input
                  id="echange-montant"
                  type="number"
                  min={0}
                  value={montantValue}
                  onChange={(e) => setMontant(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {formatDA(outgoingTotal)} sent − {formatDA(returnedTotal)} back,
                  never below 0. No delivery fee.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="echange-remarque">Remarks</Label>
                <Input
                  id="echange-remarque"
                  value={fields.remarque ?? ""}
                  onChange={(e) => patch({ remarque: e.target.value || null })}
                />
              </div>
            </section>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {submitting ? "Sending to DHD..." : "Create Échange"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
