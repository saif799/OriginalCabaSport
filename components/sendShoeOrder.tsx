"use client";

import type React from "react";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDeliveryCoverage } from "@/lib/delivery/useDeliveryCoverage";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SelectGroup } from "./ui/customSelect";
import { GroupedProduct } from "@/app/admin/(admin)/page";
import { Checkbox } from "./ui/checkbox";
import type { OrderDraft, OrderFormFields } from "@/lib/orders/placeOrder";
import type { DeliveryProviderName } from "@/lib/delivery";

// The fields this form collects, tied to the shared OrderDraft shape so a
// field rename there fails typecheck here instead of breaking silently.
type OrderFormData = OrderFormFields & { freeshipping?: boolean };

/** Per-field validation messages, keyed by the input they hang under. */
type FieldErrors = Partial<Record<keyof OrderFormFields | "size", string>>;

/**
 * A submit failure the operator has to act on. `detail` carries whatever the
 * server actually said (courier rejection text, validation message) and
 * `recovery` says what state the order is in — after a failed submit the one
 * thing worth knowing is whether a parcel now exists at the courier.
 */
type SubmitError = { title: string; detail?: string; recovery?: string };

const PROVIDER_LABELS: Record<DeliveryProviderName, string> = {
  dhd: "DHD",
  yalidine: "Yalidine",
};

/** Algerian number: 10 digits starting with 0, or the 9 digits without it. */
function isValidPhone(raw: string) {
  const digits = raw.replace(/\D/g, "");
  return /^0\d{9}$/.test(digits) || /^[5-7]\d{8}$/.test(digits);
}

export default function SendOrderForm({
  onSuccess,
  shoe,
  borrowerId,
}: {
  onSuccess?: () => void;
  shoe: GroupedProduct;
  /** Set when the order is placed from a borrower's page (sells their stock). */
  borrowerId?: string;
}) {
  // Original state for shoes management
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [success, setSuccess] = useState("");
  const [source, setSource] = useState("i");
  const alertRef = useRef<HTMLDivElement>(null);
  // Borrowers default to Yalidine; the owner defaults to DHD (cheaper at home).
  const [provider, setProvider] = useState<DeliveryProviderName>(
    borrowerId ? "yalidine" : "dhd",
  );
  const isYalidine = provider === "yalidine";

  // A size with no stock cannot be sold — placeOrder rejects it — so open on an
  // in-stock size instead of letting the form fail on submit.
  const inStockSizes = useMemo(
    () => shoe.sizes.filter((s) => s.quantity > 0),
    [shoe.sizes],
  );
  const [selectedSize, setSelectedSize] = useState<{
    inventoryId: string;
    size: string;
    quantity: number;
  }>(inStockSizes[0] ?? shoe.sizes[0]);

  const AvailableSources = [
    { code: "i", value: "instagram" },
    { code: "f", value: "facebook" },
    { code: "t", value: "tiktok" },
    { code: "w", value: "whatsapp" },
    { code: "k", value: "Ignore" },
    { code: "m", value: "mossab" },
  ];

  // New order form data state with all required fields for the API
  const [formData, setFormData] = useState<OrderFormData>({
    nom_client: "",
    telephone: "",
    telephone_2: null,
    adresse: "ville",
    commune: "",
    code_wilaya: "",
    montant: "",
    remarque: null,
    type: 1,
    stop_desk: 1,
  });

  const {
    wilayas: wilayasList,
    communeNames,
    fee,
    hasTarif,
  } = useDeliveryCoverage(
    provider,
    formData.code_wilaya,
    formData.stop_desk as 0 | 1,
  );

  const deliveryModeLabel = formData.stop_desk === 1 ? "bureau" : "à domicile";

  /** Patch the form and drop the stale error on whatever field just changed. */
  const patch = (next: Partial<OrderFormData>) => {
    setFormData((prev) => ({ ...prev, ...next }));
    setFieldErrors((prev) => {
      const cleared = { ...prev };
      for (const key of Object.keys(next)) {
        delete cleared[key as keyof FieldErrors];
      }
      return cleared;
    });
  };

  /**
   * Everything checkable without a round trip. placeOrder validates the same
   * things and stays the authority; this only exists so a missing digit is
   * caught here instead of arriving as an unlabelled 400 after the courier
   * call, with no clue which field it meant.
   */
  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};

    if (!formData.nom_client.trim()) {
      errors.nom_client = "Enter the client's name.";
    }

    if (!formData.telephone.trim()) {
      errors.telephone =
        "Enter a phone number — the courier calls before delivering.";
    } else if (!isValidPhone(formData.telephone)) {
      errors.telephone =
        "Not an Algerian number: 10 digits starting with 0 (e.g. 0555 12 34 56).";
    }

    if (formData.telephone_2?.trim() && !isValidPhone(formData.telephone_2)) {
      errors.telephone_2 =
        "Not an Algerian number — leave it empty if there is no second one.";
    }

    if (!formData.code_wilaya) {
      errors.code_wilaya = "Pick a wilaya.";
    }

    if (!formData.commune) {
      errors.commune = !formData.code_wilaya
        ? "Pick a wilaya first, then a commune."
        : communeNames.length === 0
          ? `${PROVIDER_LABELS[provider]} serves no commune in this wilaya for ${deliveryModeLabel} delivery.`
          : "Pick a commune.";
    }

    if (!formData.adresse.trim()) {
      errors.adresse = "Enter a delivery address.";
    }

    const montant = Number(formData.montant);
    if (!formData.montant.trim()) {
      errors.montant = "Enter what the client pays on delivery, in DA.";
    } else if (!Number.isFinite(montant) || montant <= 0) {
      errors.montant = "Amount must be a number greater than 0.";
    }

    if (!selectedSize) {
      errors.size = "This colour has no sizes to sell.";
    } else if (selectedSize.quantity <= 0) {
      errors.size = `Size ${selectedSize.size} is out of stock — pick a size with pairs left.`;
    }

    return errors;
  };

  /** Turn an HTTP failure into what happened, what the server said, what to do. */
  const describeFailure = async (res: Response): Promise<SubmitError> => {
    let serverMessage = "";
    try {
      const body = await res.json();
      if (typeof body?.error === "string") serverMessage = body.error;
    } catch {
      // Non-JSON body (an HTML error page, an empty 502) — nothing to read.
    }

    if (res.status === 400) {
      return {
        title:
          serverMessage ||
          "The order was rejected: something is missing or invalid.",
        recovery: "No parcel was created — fix it and submit again.",
      };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        title: "Your admin session expired.",
        recovery:
          "Reload the page and sign in again, then re-enter this order. Nothing was created.",
      };
    }
    if (res.status === 502) {
      return {
        title: `${PROVIDER_LABELS[provider]} refused the parcel.`,
        detail: serverMessage,
        recovery:
          "No parcel and no order exist. Usually the commune or the phone number is one the courier will not accept — or their API is down.",
      };
    }
    return {
      title: "The server failed while saving the order.",
      detail: serverMessage,
      recovery:
        "The parcel may already exist at the courier. Check /admin/orders before submitting this one again.",
    };
  };

  const showAlert = (error: SubmitError) => {
    setSubmitError(error);
    alertRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const handleSubmitToApi = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSuccess("");

    const errors = validate();
    const errorCount = Object.keys(errors).length;
    if (errorCount > 0) {
      setFieldErrors(errors);
      showAlert({
        title: `${errorCount} field${errorCount > 1 ? "s need" : " needs"} fixing before this order can be sent.`,
        recovery: Object.values(errors)[0],
      });
      return;
    }

    setFieldErrors({});
    setLoading(true);
    try {
      const produit = `${shoe.modelName} ${shoe.color} ${selectedSize.size} ${source}`;

      const payload: OrderDraft = {
        ...formData,
        nom_client: formData.nom_client.trim(),
        telephone: formData.telephone.trim(),
        telephone_2: formData.telephone_2?.trim() || null,
        adresse: formData.adresse.trim(),
        remarque: formData.remarque?.trim() || null,
        source,
        produit,
        provider,
        borrowerId: borrowerId ?? null,
        selectedSizeShoeId: [selectedSize.inventoryId],
      };

      const res = await fetch("/api/order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        const tracking = typeof body?.orderId === "string" ? body.orderId : "";
        toast.success(
          tracking ? `Order created — ${tracking}` : "Order created",
        );
        setSuccess(
          tracking
            ? `Order created. ${PROVIDER_LABELS[provider]} tracking: ${tracking}`
            : "Order created successfully!",
        );
        setFormData({
          nom_client: "",
          telephone: "",
          telephone_2: null,
          adresse: "ville",
          commune: "",
          code_wilaya: "",
          montant: "",
          remarque: null,
          type: 1,
          stop_desk: isYalidine ? 1 : formData.stop_desk,
        });
        onSuccess?.();
      } else {
        showAlert(await describeFailure(res));
      }
    } catch (error) {
      console.error("Error submitting order to API:", error);
      showAlert({
        title: "Couldn't reach the server.",
        detail: (error as Error)?.message,
        recovery:
          "Nothing was created. Check your connection and submit again — the form kept everything you typed.",
      });
    } finally {
      setLoading(false);
    }
  };

  const FieldError = ({ message }: { message?: string }) =>
    message ? <p className="text-xs font-medium text-red-600">{message}</p> : null;

  return (
    <div className="w-full">
      <form onSubmit={handleSubmitToApi} className="space-y-6" noValidate>
        <div ref={alertRef} aria-live="polite" className="empty:hidden">
          {submitError && (
            <Alert className="bg-red-900/20 border-red-700">
              <AlertCircle className="h-4 w-4 text-red-500" />
              <AlertTitle className="text-red-400">
                {submitError.title}
              </AlertTitle>
              {(submitError.detail || submitError.recovery) && (
                <AlertDescription className="text-red-400/90">
                  {submitError.detail && (
                    <span className="block font-mono text-xs break-words">
                      {submitError.detail}
                    </span>
                  )}
                  {submitError.recovery && (
                    <span className="block text-xs">{submitError.recovery}</span>
                  )}
                </AlertDescription>
              )}
            </Alert>
          )}

          {success && (
            <Alert className="border-green-400">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-green-400">
                {success}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="provider" className="pb-1">
            Delivery Company
          </Label>
          <Select
            name="provider"
            value={provider}
            onValueChange={(value) => {
              const next = value as DeliveryProviderName;
              setProvider(next);
              // Yalidine is used stop-desk only here; force bureau + reset commune.
              patch({
                commune: "",
                stop_desk: next === "yalidine" ? 1 : formData.stop_desk,
              });
            }}
          >
            <SelectTrigger id="provider" className="w-full">
              <SelectValue placeholder="Select delivery company" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dhd">DHD (Ecotrack)</SelectItem>
              <SelectItem value="yalidine">Yalidine (stop desk)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* No Service Type picker: this form only places a Livraison. An
            Échange is started from its Original Order's row in /admin/orders,
            which links the pairs it takes back (ADR-0009). */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="delivery-type" className="pb-1">
              delivery Type
            </Label>
            <Select
              name="delivery-type"
              value={String(formData.stop_desk)}
              disabled={isYalidine}
              onValueChange={(value) =>
                patch({ stop_desk: Number(value), commune: "" })
              }
            >
              <SelectTrigger id="delivery-type" className="w-full">
                <SelectValue placeholder="Select order type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">a domicile</SelectItem>
                <SelectItem value="1">bureau</SelectItem>
              </SelectContent>
            </Select>
            {isYalidine && (
              <p className="text-xs text-slate-500">
                Yalidine is stop-desk only here.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="nom_client">
            Client Name <span className="text-red-500">*</span>
          </Label>
          <Input
            id="nom_client"
            value={formData.nom_client}
            onChange={(e) => patch({ nom_client: e.target.value })}
            aria-invalid={!!fieldErrors.nom_client}
            placeholder="Enter client name"
            className="placeholder:text-slate-500"
          />
          <FieldError message={fieldErrors.nom_client} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="telephone">
              Phone Number <span className="text-red-500">*</span>
            </Label>
            <Input
              id="telephone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={formData.telephone}
              onChange={(e) => patch({ telephone: e.target.value })}
              aria-invalid={!!fieldErrors.telephone}
              placeholder="0555 12 34 56"
              className="placeholder:text-slate-500"
            />
            <FieldError message={fieldErrors.telephone} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="telephone_2">Alternative Phone</Label>
            <Input
              id="telephone_2"
              type="tel"
              inputMode="tel"
              value={formData.telephone_2 || ""}
              onChange={(e) => patch({ telephone_2: e.target.value })}
              aria-invalid={!!fieldErrors.telephone_2}
              placeholder="Optional second number"
              className="placeholder:text-slate-500"
            />
            <FieldError message={fieldErrors.telephone_2} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="wilaya">
              wilaya <span className="text-red-500">*</span>
            </Label>
            <Select
              name="wilaya"
              value={String(formData.code_wilaya)}
              onValueChange={(value) => {
                patch({ code_wilaya: String(value), commune: "" });
              }}
            >
              <SelectTrigger
                id="wilaya"
                className="w-full"
                aria-invalid={!!fieldErrors.code_wilaya}
              >
                <SelectValue placeholder="Select a wilaya..." />
              </SelectTrigger>
              <SelectContent className="max-w-[calc(100vw-2rem)]">
                <SelectGroup>
                  {wilayasList.map((s) => (
                    <SelectItem
                      key={s.wilayaId}
                      value={String(s.wilayaId)}
                      className={
                        formData.code_wilaya === String(s.wilayaId)
                          ? "text-green-400"
                          : "text-right"
                      }
                    >
                      {s.wilayaId} - {s.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldError message={fieldErrors.code_wilaya} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="commune">
              commune <span className="text-red-500">*</span>
            </Label>

            <Select
              name="commune"
              value={formData.commune}
              disabled={!formData.code_wilaya || communeNames.length === 0}
              onValueChange={(value) => patch({ commune: value })}
            >
              <SelectTrigger
                id="commune"
                className="w-full"
                aria-invalid={!!fieldErrors.commune}
              >
                <SelectValue
                  placeholder={
                    !formData.code_wilaya
                      ? "Pick a wilaya first"
                      : communeNames.length === 0
                        ? "No commune served here"
                        : "Select a commune..."
                  }
                />
              </SelectTrigger>
              <SelectContent className="max-w-[calc(100vw-2rem)]">
                <SelectGroup>
                  {formData.code_wilaya &&
                    communeNames.map((name) => (
                      <SelectItem
                        key={name}
                        value={name}
                        className={
                          formData.commune === name
                            ? "text-green-400"
                            : "text-right"
                        }
                      >
                        {name}
                      </SelectItem>
                    ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldError message={fieldErrors.commune} />
            {formData.code_wilaya &&
              communeNames.length === 0 &&
              !fieldErrors.commune && (
                <p className="text-xs text-amber-600">
                  {PROVIDER_LABELS[provider]} serves no commune here for{" "}
                  {deliveryModeLabel} delivery — try the other delivery type or
                  courier.
                </p>
              )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="adresse">
              Address <span className="text-red-500">*</span>
            </Label>
            <Input
              id="adresse"
              value={formData.adresse}
              onChange={(e) => patch({ adresse: e.target.value })}
              aria-invalid={!!fieldErrors.adresse}
              placeholder="Enter delivery address"
              className="placeholder:text-slate-500"
            />
            <FieldError message={fieldErrors.adresse} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="montant">
                Amount <span className="text-red-500">*</span>
              </Label>
              {formData.code_wilaya && hasTarif && (
                <span className="text-xs font-semibold text-orange-700">
                  livraison {fee} DA
                </span>
              )}
            </div>
            <Input
              id="montant"
              value={formData.montant}
              onChange={(e) => patch({ montant: e.target.value })}
              aria-invalid={!!fieldErrors.montant}
              type="number"
              inputMode="numeric"
              min="0"
              placeholder="Enter order amount"
              className="placeholder:text-slate-500"
            />
            <FieldError message={fieldErrors.montant} />
            {formData.code_wilaya && !hasTarif && !fieldErrors.montant && (
              <p className="text-xs text-amber-600">
                No tarif loaded for this wilaya — sync coverage in
                /admin/settings if the fee should show.
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="size" className="pb-1">
              size <span className="text-red-500">*</span>
            </Label>
            <Select
              name="size"
              value={selectedSize?.size ?? ""}
              onValueChange={(value) => {
                const next = shoe.sizes.find((s) => s.size === value);
                if (next) setSelectedSize(next);
                setFieldErrors((prev) => {
                  const cleared = { ...prev };
                  delete cleared.size;
                  return cleared;
                });
              }}
            >
              <SelectTrigger
                id="size"
                className="w-full"
                aria-invalid={!!fieldErrors.size}
              >
                <SelectValue placeholder="Select a size" />
              </SelectTrigger>
              <SelectContent>
                {shoe.sizes.map((s) => (
                  <SelectItem
                    key={s.inventoryId}
                    value={s.size}
                    disabled={s.quantity <= 0}
                  >
                    {s.size}
                    <span className="text-muted-foreground text-xs">
                      {s.quantity > 0 ? `${s.quantity} left` : "out of stock"}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError message={fieldErrors.size} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="source" className="pb-1">
              Source
            </Label>
            <Select
              name="source"
              value={source}
              onValueChange={(value) => {
                setSource(value);
              }}
            >
              <SelectTrigger id="source" className="w-full">
                <SelectValue placeholder="Select Source " />
              </SelectTrigger>
              <SelectContent>
                {AvailableSources.map((source) => (
                  <SelectItem key={source.code} value={source.code}>
                    {source.value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="product">Product</Label>
            <Input
              disabled
              id="product"
              value={`${shoe.modelName} ${shoe.color} ${selectedSize?.size ?? "-"} ${source}`}
              className="placeholder:text-slate-500"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="remarque">Remarks</Label>
            <Input
              id="remarque"
              value={formData.remarque || ""}
              onChange={(e) => patch({ remarque: e.target.value })}
              placeholder="Additional notes or remarks"
              className="placeholder:text-slate-500"
            />
          </div>
        </div>
        {isYalidine && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="freeshipping"
              checked={formData.freeshipping}
              onCheckedChange={(checked) =>
                patch({ freeshipping: checked as boolean })
              }
            />
            <label
              htmlFor="freeshipping"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Free Shipping
            </label>
          </div>
        )}
        <Button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating order at {PROVIDER_LABELS[provider]}...
            </>
          ) : (
            "Create Order"
          )}
        </Button>
      </form>
    </div>
  );
}
