"use client";

import type React from "react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  Camera,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  Plus,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cleanColorName, colorKey } from "@/lib/arrivals/colorKey";
import {
  DEFAULT_SIZES,
  linePairs,
  parseDraft,
  parseSizeInput,
  sortSizes,
  type CartLine,
  type CreatedColour,
  type ModelColour,
} from "@/lib/arrivals/form";
import { formatDA } from "@/lib/format";
import { cn } from "@/lib/utils";
import AddedShoeCard from "./addedShoeCard";

type Model = {
  id: string;
  modelName: string;
  basePrice: number;
  compareAtPrice: number | null;
  archived: boolean;
};

// Whether a colour is new or existing is a fact the form derives from what was
// picked, never a mode the owner chooses.
type ColourPick =
  | { kind: "existing"; shoeId: string }
  | { kind: "new"; color: string };

type Saved = {
  colours: number;
  pairs: number;
  created: CreatedColour[];
};

const DRAFT_KEY = "ocs:arrivage-draft:v1";

const newLineKey = (modelId: string, color: string) =>
  `new:${modelId}:${colorKey(color)}`;
const existingLineKey = (shoeId: string) => `shoe:${shoeId}`;
const lineKeyFor = (modelId: string, pick: ColourPick) =>
  pick.kind === "existing"
    ? existingLineKey(pick.shoeId)
    : newLineKey(modelId, pick.color);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function quantitiesOf(line: CartLine | undefined): Record<string, string> {
  if (!line) return {};
  return Object.fromEntries(line.sizes.map((s) => [s.size, String(s.quantity)]));
}

function toQuantity(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export default function AddShoeForm() {
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState<Model | null>(null);
  // Tagged with the model they belong to, so one model's colours can never be
  // shown under another while a request is in flight.
  const [loadedColours, setLoadedColours] = useState<{
    modelId: string;
    list: ModelColour[];
  } | null>(null);
  const [pick, setPick] = useState<ColourPick | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [extraSizes, setExtraSizes] = useState<string[]>([]);
  const [sizeDraft, setSizeDraft] = useState("");

  const [cart, setCart] = useState<CartLine[]>([]);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [draftRestored, setDraftRestored] = useState(false);

  const [modelOpen, setModelOpen] = useState(false);
  const [colourOpen, setColourOpen] = useState(false);
  const [colourSearch, setColourSearch] = useState("");
  const [showNewModel, setShowNewModel] = useState(false);
  const [newModel, setNewModel] = useState({
    name: "",
    basePrice: "",
    compareAtPrice: "",
  });
  const [addingModel, setAddingModel] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [error, setError] = useState("");

  const colourTriggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const arrivageRef = useRef<HTMLElement>(null);
  const focusGridOnClose = useRef(false);
  const coloursRequest = useRef("");

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch("/api/models");
      if (!res.ok) throw new Error(String(res.status));
      setModels(await res.json());
    } catch (err) {
      console.error("Failed to fetch models:", err);
      setError("Could not load the models. Reload the page.");
    }
  }, []);

  // One request per model selection. Stock figures and picker contents are
  // always read from the server — the draft never restores them.
  const fetchColours = useCallback(async (modelId: string) => {
    coloursRequest.current = modelId;
    try {
      const res = await fetch(`/api/shoes?modelId=${encodeURIComponent(modelId)}`);
      if (!res.ok) throw new Error(String(res.status));
      const list: ModelColour[] = await res.json();
      if (coloursRequest.current === modelId) {
        setLoadedColours({ modelId, list });
      }
    } catch (err) {
      console.error("Failed to fetch colours:", err);
      if (coloursRequest.current === modelId) {
        setError("Could not load this model's colours. Pick the model again.");
      }
    }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // The draft is read after mount, not during render: the server has no
  // localStorage, and rendering it straight away would mismatch on hydration.
  useEffect(() => {
    try {
      const draft = parseDraft(window.localStorage.getItem(DRAFT_KEY));
      if (draft) {
        setCart(draft.cart);
        setReference(draft.reference);
        setNote(draft.note);
      }
    } catch {
      // Private mode or blocked storage: the page works without a draft.
    }
    setDraftRestored(true);
  }, []);

  useEffect(() => {
    if (!draftRestored) return;
    try {
      if (cart.length === 0 && !reference && !note) {
        window.localStorage.removeItem(DRAFT_KEY);
      } else {
        window.localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ cart, reference, note }),
        );
      }
    } catch {
      // Same as above — losing the autosave must not break entry.
    }
  }, [draftRestored, cart, reference, note]);

  const colours = useMemo(
    () => (model && loadedColours?.modelId === model.id ? loadedColours.list : []),
    [model, loadedColours],
  );
  const coloursLoading = !!model && loadedColours?.modelId !== model.id;

  const pickedColour =
    pick?.kind === "existing" ? colours.find((c) => c.id === pick.shoeId) : undefined;
  const pickedName =
    pick?.kind === "new" ? pick.color : (pickedColour?.color ?? "");
  const lineKey = model && pick ? lineKeyFor(model.id, pick) : null;
  const stagedLine = lineKey ? cart.find((l) => l.key === lineKey) : undefined;

  // Colours this arrivage will create for the selected model.
  const stagedNewColours = useMemo(
    () =>
      model
        ? cart.filter(
            (l) =>
              l.mode === "new" &&
              l.modelId === model.id &&
              !colours.some((c) => colorKey(c.color) === colorKey(l.color)),
          )
        : [],
    [cart, model, colours],
  );

  const searchKey = colorKey(colourSearch);
  const matches = (name: string) => colorKey(name).includes(searchKey);
  // The exact name leads the list, so Enter on "red" picks Red and not the
  // Dark Red that merely contains it.
  const exactFirst = <T extends { color: string }>(list: T[]) =>
    [...list].sort(
      (a, b) =>
        Number(colorKey(b.color) === searchKey) -
        Number(colorKey(a.color) === searchKey),
    );
  const visibleColours = exactFirst(colours.filter((c) => matches(c.color)));
  const visibleStaged = exactFirst(
    stagedNewColours.filter((l) => matches(l.color)),
  );
  const stagedLeads = visibleStaged.some((l) => colorKey(l.color) === searchKey);
  // Offered only when the name is not already a colour of this model, in the
  // table or in this arrivage: typing an existing name selects that colour.
  const offerNew =
    searchKey !== "" &&
    !colours.some((c) => colorKey(c.color) === searchKey) &&
    !stagedNewColours.some((l) => colorKey(l.color) === searchKey);

  const sizes = useMemo(() => {
    const known = colours.flatMap((c) => c.sizes.map((s) => s.size));
    const staged = model
      ? cart
          .filter((l) => l.modelId === model.id)
          .flatMap((l) => l.sizes.map((s) => s.size))
      : [];
    return sortSizes([
      ...(known.length ? known : DEFAULT_SIZES),
      ...staged,
      ...extraSizes,
    ]);
  }, [colours, cart, model, extraSizes]);

  const stockBySize = useMemo(
    () => new Map(pickedColour?.sizes.map((s) => [s.size, s.quantity])),
    [pickedColour],
  );

  const linePairsTotal = sizes.reduce(
    (sum, size) => sum + toQuantity(quantities[size]),
    0,
  );
  const totalPairs = cart.reduce((sum, l) => sum + linePairs(l), 0);

  const selectModel = (next: Model) => {
    setModel(next);
    setModelOpen(false);
    setPick(null);
    setQuantities({});
    setExtraSizes([]);
    setColourSearch("");
    setError("");
    fetchColours(next.id);
  };

  // Picking a colour that is already staged loads its line into the grid: the
  // grid is the editor, and submitting replaces the line.
  const selectColour = (next: ColourPick) => {
    if (!model) return;
    const key = lineKeyFor(model.id, next);
    setPick(next);
    setQuantities(quantitiesOf(cart.find((l) => l.key === key)));
    setColourSearch("");
    setError("");
    focusGridOnClose.current = true;
    setColourOpen(false);
  };

  const editLine = (line: CartLine) => {
    const lineModel = models.find((m) => m.id === line.modelId);
    if (!lineModel) {
      toast.error(`${line.modelName} is no longer in the model list`);
      return;
    }
    if (model?.id !== lineModel.id) {
      setModel(lineModel);
      setExtraSizes([]);
      fetchColours(lineModel.id);
    }
    setPick(
      line.mode === "existing" && line.shoeId
        ? { kind: "existing", shoeId: line.shoeId }
        : { kind: "new", color: line.color },
    );
    setQuantities(quantitiesOf(line));
    setError("");
    requestAnimationFrame(() => {
      gridRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      gridRef.current?.querySelector("input")?.focus();
    });
  };

  const handleAddModel = async () => {
    const name = newModel.name.trim();
    if (!name || addingModel) return;

    const basePrice = newModel.basePrice.trim();
    const compareAtPrice = newModel.compareAtPrice.trim();
    if (
      (basePrice && !/^\d+$/.test(basePrice)) ||
      (compareAtPrice && !/^\d+$/.test(compareAtPrice))
    ) {
      setError("Prices are whole numbers of DA");
      return;
    }

    setAddingModel(true);
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelName: name,
          ...(basePrice ? { basePrice: Number(basePrice) } : {}),
          ...(Number(compareAtPrice) > 0
            ? { compareAtPrice: Number(compareAtPrice) }
            : {}),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        // Duplicate names are rejected server-side; without this the button
        // just did nothing and the name looked accepted.
        setError(data?.error || "Failed to add model");
        return;
      }

      setModels((prev) => [...prev, data]);
      setNewModel({ name: "", basePrice: "", compareAtPrice: "" });
      setShowNewModel(false);
      selectModel(data);
    } catch {
      setError("Failed to add model");
    } finally {
      setAddingModel(false);
    }
  };

  const addSize = () => {
    const size = parseSizeInput(sizeDraft);
    if (!size) {
      setError("A size is a number, like 42 or 36.5");
      return;
    }
    setError("");
    setSizeDraft("");
    if (!sizes.includes(size)) setExtraSizes((prev) => [...prev, size]);
    requestAnimationFrame(() =>
      document.getElementById(`arrivage-size-${size}`)?.focus(),
    );
  };

  // Stage the grid as this colour's line. Nothing hits the DB until "Save
  // arrivage" — the whole cart is committed as one shipment.
  const handleSubmitLine = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!model) {
      setError("Select a model");
      return;
    }
    if (!pick || !lineKey || !pickedName) {
      setError("Pick a colour");
      return;
    }
    const lineSizes = sizes
      .map((size) => ({ size, quantity: toQuantity(quantities[size]) }))
      .filter((s) => s.quantity > 0);
    if (lineSizes.length === 0) {
      setError(
        stagedLine
          ? "Enter at least one pair — or remove the line with ×"
          : "Enter a quantity for at least one size",
      );
      return;
    }

    const line: CartLine = {
      key: lineKey,
      mode: pick.kind,
      modelId: model.id,
      modelName: model.modelName,
      color: pickedName,
      ...(pick.kind === "existing" ? { shoeId: pick.shoeId } : {}),
      sizes: lineSizes,
    };
    // Replaced where it stands, never summed: correcting a typo and adding a
    // size are the same gesture.
    setCart((prev) =>
      prev.some((l) => l.key === line.key)
        ? prev.map((l) => (l.key === line.key ? line : l))
        : [...prev, line],
    );

    // Keep the model for the next colour; clear the rest.
    setPick(null);
    setQuantities({});
    colourTriggerRef.current?.focus();
  };

  const removeLine = (key: string) => {
    const index = cart.findIndex((l) => l.key === key);
    if (index === -1) return;
    const line = cart[index];
    setCart((prev) => prev.filter((l) => l.key !== key));
    toast(`Removed ${line.modelName} — ${line.color}`, {
      action: {
        label: "Undo",
        onClick: () =>
          setCart((prev) =>
            prev.some((l) => l.key === line.key)
              ? prev
              : [...prev.slice(0, index), line, ...prev.slice(index)],
          ),
      },
    });
  };

  const discardDraft = () => {
    const before = { cart, reference, note };
    setCart([]);
    setReference("");
    setNote("");
    toast("Arrivage discarded", {
      action: {
        label: "Undo",
        onClick: () => {
          setCart(before.cart);
          setReference(before.reference);
          setNote(before.note);
        },
      },
    });
  };

  const handleSaveArrivage = async () => {
    if (cart.length === 0 || saving) return;
    setSaving(true);
    setError("");

    const lines = cart.map((l) =>
      l.mode === "existing"
        ? { mode: "existing" as const, shoeId: l.shoeId, sizes: l.sizes }
        : {
            mode: "new" as const,
            modelId: l.modelId,
            color: l.color,
            sizes: l.sizes,
          },
    );

    try {
      const res = await fetch("/api/arrivals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference: reference.trim() || undefined,
          note: note.trim() || undefined,
          lines,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(data?.error || "Failed to save arrivage");
        return;
      }

      setSaved({
        colours: cart.length,
        pairs: totalPairs,
        created: Array.isArray(data?.created) ? data.created : [],
      });
      setCart([]);
      setReference("");
      setNote("");
      setPick(null);
      setQuantities({});
      // The save changed stock, may have created colours and may have
      // unarchived some: everything the pickers show is stale.
      fetchModels();
      if (model) fetchColours(model.id);
      // On a phone the arrivage sits below the form, and the bar that was
      // just tapped disappears with the cart: bring the confirmation up.
      requestAnimationFrame(() =>
        arrivageRef.current?.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        }),
      );
    } catch {
      toast.error("Failed to save arrivage");
    } finally {
      setSaving(false);
    }
  };

  const startAnother = () => {
    setSaved(null);
    setModel(null);
    setPick(null);
    setQuantities({});
    setExtraSizes([]);
    setError("");
  };

  const priceEmpty = newModel.basePrice.trim() === "" || Number(newModel.basePrice) === 0;

  const stagedItems = visibleStaged.map((l) => (
    <CommandItem
      key={l.key}
      value={l.key}
      onSelect={() => selectColour({ kind: "new", color: l.color })}
    >
      <span className="min-w-0 truncate">{l.color}</span>
      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
        this arrivage
      </span>
    </CommandItem>
  ));

  return (
    <div className="w-full">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
        {/* ── Entry form ─────────────────────────────────────────────── */}
        <div className="min-w-0 space-y-6">
          {error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label id="arrivage-model-label">Model</Label>
            <div className="flex min-w-0 gap-2">
              <Popover open={modelOpen} onOpenChange={setModelOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={modelOpen}
                    aria-labelledby="arrivage-model-label"
                    className="min-w-0 flex-1 justify-between"
                  >
                    <span className="min-w-0 truncate">
                      {model ? model.modelName : "Select a model…"}
                    </span>
                    <ChevronsUpDown className="shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-(--radix-popover-trigger-width) p-0"
                >
                  {/* Matched on the name alone — the value is the id, which
                      must not turn "ad" into a hit on every uuid. */}
                  <Command
                    className="rounded-lg"
                    filter={(_value, search, keywords) =>
                      colorKey(keywords?.[0] ?? "").includes(colorKey(search))
                        ? 1
                        : 0
                    }
                  >
                    <CommandInput placeholder="Search models…" />
                    <CommandList>
                      <CommandEmpty>No model by that name.</CommandEmpty>
                      <CommandGroup>
                        {models.map((m) => (
                          <CommandItem
                            key={m.id}
                            value={m.id}
                            keywords={[m.modelName]}
                            onSelect={() => selectModel(m)}
                          >
                            <span className="min-w-0 truncate">{m.modelName}</span>
                            {m.archived && (
                              <span className="shrink-0 text-xs text-muted-foreground">
                                (archived)
                              </span>
                            )}
                            {model?.id === m.id && <Check className="ml-auto" />}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              <Button
                type="button"
                onClick={() => setShowNewModel((open) => !open)}
                variant="outline"
                className="shrink-0"
                aria-label="New model"
                aria-expanded={showNewModel}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {model && !showNewModel && (
              <p className="text-xs text-muted-foreground">
                {model.basePrice > 0 ? (
                  <>
                    Price {formatDA(model.basePrice)}
                    {model.compareAtPrice != null &&
                      ` · compare-at ${formatDA(model.compareAtPrice)}`}
                  </>
                ) : (
                  "No price yet — hidden from the storefront until priced in Products."
                )}
                {model.archived &&
                  " · Archived: saving this arrivage brings it back."}
              </p>
            )}

            {showNewModel && (
              <div
                className="space-y-3 rounded-lg border bg-card p-3"
                onKeyDown={(e) => {
                  // Enter in a field adds the model. On the buttons it must
                  // stay a click — Enter on Cancel cancels.
                  if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
                    e.preventDefault();
                    handleAddModel();
                  }
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="new-model-name">New model name</Label>
                  <Input
                    id="new-model-name"
                    autoFocus
                    placeholder="e.g. Air Force 1"
                    value={newModel.name}
                    onChange={(e) =>
                      setNewModel({ ...newModel, name: e.target.value })
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="new-model-price">Price (DA)</Label>
                    <Input
                      id="new-model-price"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      placeholder="optional"
                      aria-describedby={priceEmpty ? "new-model-price-hint" : undefined}
                      value={newModel.basePrice}
                      onChange={(e) =>
                        setNewModel({ ...newModel, basePrice: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-model-compare">Compare-at (DA)</Label>
                    <Input
                      id="new-model-compare"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      placeholder="optional"
                      value={newModel.compareAtPrice}
                      onChange={(e) =>
                        setNewModel({
                          ...newModel,
                          compareAtPrice: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
                {priceEmpty && (
                  <p
                    id="new-model-price-hint"
                    className="text-xs text-muted-foreground"
                  >
                    Without a price the model is hidden from the storefront
                    until you price it.
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowNewModel(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={handleAddModel}
                    disabled={!newModel.name.trim() || addingModel}
                  >
                    {addingModel ? "Adding…" : "Add model"}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label id="arrivage-colour-label">Colour</Label>
            <Popover
              open={colourOpen}
              onOpenChange={(open) => {
                setColourOpen(open);
                if (!open) setColourSearch("");
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  ref={colourTriggerRef}
                  variant="outline"
                  role="combobox"
                  aria-expanded={colourOpen}
                  aria-labelledby="arrivage-colour-label"
                  disabled={!model}
                  className="w-full justify-between"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate">
                      {pick
                        ? pickedName || "…"
                        : model
                          ? "Pick or type a colour…"
                          : "Select a model first"}
                    </span>
                    {pick?.kind === "new" && (
                      <Badge variant="secondary">new colour</Badge>
                    )}
                    {pickedColour?.archived && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        (archived)
                      </span>
                    )}
                  </span>
                  <ChevronsUpDown className="shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-(--radix-popover-trigger-width) p-0"
                onCloseAutoFocus={(e) => {
                  // After a pick, focus belongs in the grid, not back on the
                  // trigger.
                  if (!focusGridOnClose.current) return;
                  focusGridOnClose.current = false;
                  e.preventDefault();
                  gridRef.current?.querySelector("input")?.focus();
                }}
              >
                {/* Filtered by hand: cmdk's fuzzy match knows nothing about
                    colorKey, and the "new colour" entry must follow the same
                    rule the route uses to decide what a duplicate is. */}
                <Command shouldFilter={false} className="rounded-lg">
                  <CommandInput
                    placeholder="Search or type a new colour…"
                    value={colourSearch}
                    onValueChange={setColourSearch}
                  />
                  <CommandList>
                    {coloursLoading ? (
                      <div className="py-6 text-center text-sm text-muted-foreground">
                        Loading colours…
                      </div>
                    ) : (
                      <>
                        {!offerNew &&
                          visibleColours.length === 0 &&
                          visibleStaged.length === 0 && (
                            <div className="py-6 text-center text-sm text-muted-foreground">
                              No colours yet — type a name to add one.
                            </div>
                          )}
                        {(visibleColours.length > 0 || visibleStaged.length > 0) && (
                          <CommandGroup>
                            {stagedLeads && stagedItems}
                            {visibleColours.map((c) => {
                              const staged = cart.some(
                                (l) => l.key === existingLineKey(c.id),
                              );
                              return (
                                <CommandItem
                                  key={c.id}
                                  value={existingLineKey(c.id)}
                                  onSelect={() =>
                                    selectColour({ kind: "existing", shoeId: c.id })
                                  }
                                >
                                  <span className="min-w-0 truncate">{c.color}</span>
                                  {c.archived && (
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                      (archived)
                                    </span>
                                  )}
                                  {staged && (
                                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                                      this arrivage
                                    </span>
                                  )}
                                </CommandItem>
                              );
                            })}
                            {!stagedLeads && stagedItems}
                          </CommandGroup>
                        )}
                        {offerNew && (
                          <CommandGroup>
                            <CommandItem
                              value="__new-colour__"
                              onSelect={() =>
                                selectColour({
                                  kind: "new",
                                  color: cleanColorName(colourSearch),
                                })
                              }
                            >
                              <Plus />
                              <span className="min-w-0 truncate">
                                New colour “{cleanColorName(colourSearch)}”
                              </span>
                            </CommandItem>
                          </CommandGroup>
                        )}
                      </>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* Enter anywhere in the grid submits the line. */}
          <form onSubmit={handleSubmitLine} className="space-y-4">
            <fieldset disabled={!pick} className="min-w-0 space-y-2">
              <legend className="flex w-full items-baseline justify-between text-sm font-medium">
                <span>Pairs per size</span>
                <span className="text-xs font-normal tabular-nums text-muted-foreground">
                  {plural(linePairsTotal, "pair")}
                </span>
              </legend>

              <div ref={gridRef} className="flex flex-wrap gap-2">
                {sizes.map((size) => {
                  const stock = stockBySize.get(size);
                  return (
                    <div key={size} className="flex w-14 flex-col items-center gap-1">
                      <Label
                        htmlFor={`arrivage-size-${size}`}
                        className="text-xs tabular-nums"
                      >
                        {size}
                      </Label>
                      <Input
                        id={`arrivage-size-${size}`}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        placeholder="0"
                        value={quantities[size] ?? ""}
                        onChange={(e) =>
                          setQuantities((prev) => ({
                            ...prev,
                            [size]: e.target.value,
                          }))
                        }
                        onFocus={(e) => e.target.select()}
                        className={cn(
                          "h-9 px-1 text-center tabular-nums",
                          toQuantity(quantities[size]) > 0 && "border-primary",
                        )}
                      />
                      {pickedColour && (
                        <span
                          className="text-[11px] tabular-nums text-muted-foreground"
                          title={
                            stock == null
                              ? "This colour does not have this size yet"
                              : `${stock} in stock now`
                          }
                        >
                          {stock ?? "–"}
                        </span>
                      )}
                    </div>
                  );
                })}

                <div className="flex w-24 flex-col items-center gap-1">
                  <Label htmlFor="arrivage-add-size" className="text-xs">
                    + size
                  </Label>
                  <div className="flex gap-1">
                    <Input
                      id="arrivage-add-size"
                      inputMode="decimal"
                      placeholder="46"
                      value={sizeDraft}
                      onChange={(e) => setSizeDraft(e.target.value)}
                      onKeyDown={(e) => {
                        // Enter here adds the size; it must not submit the line.
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addSize();
                        }
                      }}
                      className="h-9 px-1 text-center tabular-nums"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-9 shrink-0"
                      onClick={addSize}
                      aria-label="Add size"
                    >
                      <Plus />
                    </Button>
                  </div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                {!pick
                  ? "Pick a colour to enter what arrived."
                  : pickedColour
                    ? "Under each size: pairs in stock now (– means the colour does not have that size yet). Sizes left at 0 are not added."
                    : "Sizes left at 0 are not added."}
              </p>
            </fieldset>

            <Button type="submit" variant="outline" className="w-full" disabled={!pick}>
              {stagedLine ? <Check /> : <Plus />}
              {stagedLine ? "Update line" : "Add to arrivage"}
            </Button>
          </form>
        </div>

        {/* ── The arrivage ───────────────────────────────────────────── */}
        <aside
          ref={arrivageRef}
          aria-label="Current arrivage"
          className="min-w-0 space-y-4 lg:sticky lg:top-20"
        >
          {saved && (
            <div
              role="status"
              className="space-y-3 rounded-lg border bg-card p-4 text-card-foreground"
            >
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="font-semibold">Arrivage saved</p>
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {plural(saved.colours, "colour")} ·{" "}
                    {plural(saved.pairs, "pair")}
                  </p>
                </div>
              </div>

              {saved.created.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    New colours have no photograph yet:
                  </p>
                  <ul className="space-y-1.5">
                    {saved.created.map((c) => (
                      <li
                        key={c.shoeId}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="min-w-0 truncate">
                          {c.modelName} — {c.color}
                        </span>
                        <Button asChild variant="outline" size="sm" className="shrink-0">
                          <Link href={`/admin/products/${c.shoeId}/edit`}>
                            <Camera />
                            Add photos
                          </Link>
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={startAnother}>
                  Start another
                </Button>
                <Button asChild variant="ghost">
                  <Link href="/admin/arrivals">View arrivals</Link>
                </Button>
              </div>
            </div>
          )}

          {(!saved || cart.length > 0) && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">Current arrivage</h2>
                {cart.length > 0 && (
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {plural(cart.length, "colour")} · {plural(totalPairs, "pair")}
                  </span>
                )}
              </div>

              {cart.length > 0 ? (
                // Scrolls on its own on desktop, so a long arrivage cannot
                // push the reference, note and Save out of the sticky column.
                <div className="space-y-2 lg:max-h-[calc(100dvh-25rem)] lg:min-h-28 lg:overflow-y-auto lg:p-0.5">
                  {cart.map((line) => (
                    <AddedShoeCard
                      key={line.key}
                      modelName={line.modelName}
                      color={line.color}
                      sizes={line.sizes}
                      isNew={line.mode === "new"}
                      active={line.key === lineKey}
                      onSelect={() => editLine(line)}
                      onRemove={() => removeLine(line.key)}
                    />
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  Nothing staged yet. Build the shipment colour by colour, then
                  save it as one arrivage.
                </p>
              )}

              <div className="space-y-2">
                <div className="space-y-1.5">
                  <Label htmlFor="arrivage-reference">Reference</Label>
                  <Input
                    id="arrivage-reference"
                    placeholder="optional"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="arrivage-note">Note</Label>
                  <Input
                    id="arrivage-note"
                    placeholder="supplier, invoice… (optional)"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={handleSaveArrivage}
                  disabled={saving || cart.length === 0}
                  className="flex-1"
                >
                  {saving ? "Saving…" : "Save arrivage"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={discardDraft}
                  disabled={saving || (cart.length === 0 && !reference && !note)}
                >
                  Discard
                </Button>
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Phone: the arrivage is below the fold, so its totals and Save ride
          along the bottom edge. */}
      {cart.length > 0 && (
        <div className="sticky bottom-0 z-20 -mx-4 mt-6 flex items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8 lg:hidden">
          <span className="text-sm font-medium tabular-nums">
            {plural(cart.length, "colour")} · {plural(totalPairs, "pair")}
          </span>
          <Button type="button" onClick={handleSaveArrivage} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}
