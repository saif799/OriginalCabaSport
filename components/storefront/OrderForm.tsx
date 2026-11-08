"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Wallet, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SelectGroup } from "@/components/ui/customSelect";
import { cn } from "@/lib/utils";
import { formatDZD, normalizeDigits } from "@/lib/format";
import { useDeliveryCoverage } from "@/lib/delivery/useDeliveryCoverage";
import type { OrderDraft } from "@/lib/orders/placeOrder";
import { BRAND } from "@/lib/storefront/seo";
import { trackBeginCheckout } from "@/lib/storefront/analytics";
import Ltr from "@/components/storefront/Ltr";
import { Trans, useLocalePath, useT } from "@/app/i18n/client";

type SizeOption = {
  inventoryId: string;
  size: string;
  quantity: number;
  resolvedPrice: number;
};

const PHONE_REGEX = /^0[5-7]\d{8}$/;

/**
 * Design system §8.2. Fields are 56px tall (`h-14`) and identified by their
 * placeholder rather than a visible label — the labels are kept as sr-only
 * text so the form stays accessible without breaking the look. This is "step
 * 2": it dims until SizeSelector's step 1 is satisfied, and the submit CTA
 * carries the running total so the price is never a surprise on tap. A
 * sticky mobile bar mirrors the same total + CTA once the form scrolls out
 * of view.
 */
export default function OrderForm({
  shoeId,
  modelName,
  color,
  selectedSize,
  onMissingSize,
}: {
  /** Carried only for the Meta pixel — one Meta "product" per colour variant. */
  shoeId: string;
  modelName: string;
  color: string;
  selectedSize: SizeOption | null;
  /** Called instead of blocking submit when no size is picked yet — scrolls
   *  the customer back up to SizeSelector rather than disabling the CTA. */
  onMissingSize: () => void;
}) {
  const { t } = useT("checkout");
  const localeHref = useLocalePath();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [nomClient, setNomClient] = useState("");
  const [telephone, setTelephone] = useState("");
  const [codeWilaya, setCodeWilaya] = useState("");
  const [commune, setCommune] = useState("");
  const [stopDesk, setStopDesk] = useState<0 | 1>(0);

  // Commune first, mode second: the customer picks any commune the courier
  // serves, and the toggle below adapts to it. Filtering communes by the
  // selected mode instead would hide ~94% of them with no visible cause.
  const {
    wilayas,
    communeNames,
    fee,
    hasTarif,
    homeFee,
    deskFee,
    modeAvailable,
    wilayaSupports,
  } = useDeliveryCoverage("dhd", codeWilaya, stopDesk, {
    communeFilter: "any-mode",
  });

  // Before a commune is picked, fall back to the wilaya: some wilayas have no
  // stop desk at all, and the toggle should never flash as enabled there.
  const deskAvailable = commune
    ? modeAvailable(commune, "desk")
    : wilayaSupports("desk");

  useEffect(() => {
    if (!deskAvailable && stopDesk === 1) setStopDesk(0);
  }, [deskAvailable, stopDesk]);

  const productPrice = selectedSize?.resolvedPrice ?? 0;
  const total = productPrice + fee;
  const deliveryLabel =
    stopDesk === 1 ? t("delivery.deskShort") : t("delivery.home");

  // The product name, colour and size are catalog data and go into the message
  // verbatim, so the order stays readable in the shop's inbox whichever
  // language the customer checked out in.
  const productLabel = `${modelName} ${color}`;
  const whatsappMessage = encodeURIComponent(
    selectedSize
      ? t("whatsappMessage.withSize", {
          product: productLabel,
          size: selectedSize.size,
          total: formatDZD(total),
        })
      : t("whatsappMessage.withoutSize", { product: productLabel }),
  );
  const whatsappUrl = `https://wa.me/${BRAND.whatsapp}?text=${whatsappMessage}`;

  const handleWilayaChange = (value: string) => {
    setCodeWilaya(value);
    setCommune("");
  };

  const handleStopDeskChange = (value: 0 | 1) => {
    if (value === 1 && !deskAvailable) return;
    setStopDesk(value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!selectedSize) {
      onMissingSize();
      return;
    }
    if (selectedSize.quantity === 0) {
      setError(t("errors.sizeOutOfStock"));
      return;
    }
    if (!nomClient.trim()) {
      setError(t("errors.nameRequired"));
      return;
    }
    // Normalise before validating: an Arabic keyboard emits ٠٦… which the
    // ASCII-only PHONE_REGEX would otherwise reject outright.
    const normalizedPhone = normalizeDigits(telephone.trim());
    if (!PHONE_REGEX.test(normalizedPhone)) {
      setError(t("errors.phoneInvalid"));
      return;
    }
    if (!codeWilaya) {
      setError(t("errors.wilayaRequired"));
      return;
    }
    if (!commune) {
      setError(t("errors.communeRequired"));
      return;
    }

    // After validation, before the request: a click that bounced off a
    // validation error is not checkout intent. `productPrice`, not `total` —
    // the delivery fee is excluded here exactly as it is from Purchase, so the
    // two events are comparable.
    trackBeginCheckout({
      shoeId,
      contentName: modelName,
      size: selectedSize.size,
      value: selectedSize.resolvedPrice,
    });

    setLoading(true);
    try {
      const produit = `${modelName} ${color} ${selectedSize.size}`;
      const payload: OrderDraft = {
        nom_client: nomClient.trim(),
        telephone: normalizedPhone,
        telephone_2: null,
        // Address is never asked on the storefront — the owner confirms it by phone.
        adresse: "ville",
        commune,
        code_wilaya: codeWilaya,
        montant: String(total),
        remarque: null,
        type: 1,
        stop_desk: stopDesk,
        source: "storefront",
        provider: "dhd",
        produit,
        selectedSizeShoeId: [selectedSize.inventoryId],
        borrowerId: null,
      };
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok && data.orderId) {
        // Locale-prefixed: the bare path would be caught by proxy.ts and
        // bounce an Arabic customer onto the French confirmation page.
        router.push(localeHref(`/order/${data.orderId}/confirm`));
      } else {
        setError(data?.error || t("errors.submitFailed"));
      }
    } catch {
      setError(t("errors.unexpected"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="sf-body space-y-3">
      <div className="flex items-baseline gap-3 pb-1">
        <span
          className="flex h-[22px] min-w-[22px] translate-y-[3px] items-center justify-center border border-(--sf-text) text-xs font-medium text-(--sf-text)"
          style={{ borderRadius: "var(--sf-radius-sm)" }}
        >
          2
        </span>
        <h2 className={cn("text-sm font-medium md:text-xl")}>
          {t("form.heading")}
        </h2>
      </div>

      {error && (
        <p
          role="alert"
          className="py-2 text-center text-[0.8rem] font-medium text-(--sf-danger)"
        >
          {error}
        </p>
      )}

      <div className="space-y-3" >
        <div>
          <label htmlFor="nom_client" className="sr-only">
            {t("form.nameLabel")}
          </label>
          <Input
            id="nom_client"
            className="h-14"
            value={nomClient}
            onChange={(e) => setNomClient(e.target.value)}
            placeholder={t("form.namePlaceholder")}
          />
        </div>

        <div>
          <label htmlFor="telephone" className="sr-only">
            {t("form.phoneLabel")}
          </label>
          <Input
            id="telephone"
            type="tel"
            // Digits are an LTR run even on an RTL page; alignment still
            // follows the page direction.
            dir="ltr"
            className="h-14 text-start"
            value={telephone}
            onChange={(e) => setTelephone(e.target.value)}
            placeholder={t("form.phonePlaceholder")}
          />
        </div>

        <div className="flex justify-between gap-3">
          <div className="basis-1/2">
            <Select value={codeWilaya} onValueChange={handleWilayaChange}>
              <SelectTrigger className="h-14 w-full" aria-label={t("form.wilaya")}>
                <SelectValue placeholder={t("form.wilaya")} />
              </SelectTrigger>
              {/* Coverage rows are catalog data (courier spellings), shown
                  exactly as the API returns them — so the list stays LTR. */}
              <SelectContent className="sf-portal" dir="ltr">
                <SelectGroup>
                  {wilayas.map((w) => (
                    <SelectItem key={w.wilayaId} value={String(w.wilayaId)}>
                      {w.wilayaId} - {w.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="basis-1/2">
            <Select
              value={commune}
              onValueChange={setCommune}
              disabled={!codeWilaya}
            >
              <SelectTrigger className="h-14 w-full" aria-label={t("form.commune")}>
                <SelectValue placeholder={t("form.commune")} />
              </SelectTrigger>
              <SelectContent className="sf-portal" dir="ltr">
                <SelectGroup>
                  {communeNames.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3 pb-1.5">
            <span className="text-[11px] font-medium tracking-wider text-(--sf-muted) uppercase">
              {t("delivery.modeLabel")}
            </span>
            <span className="text-[11px] text-(--sf-muted)">
              {!codeWilaya ? (
                ""
              ) : !deskAvailable ? (
                commune ? (
                  t("delivery.deskUnavailableCommune")
                ) : (
                  t("delivery.deskUnavailableWilaya")
                )
              ) : hasTarif ? (
                <Trans
                  t={t}
                  i18nKey="delivery.feeHint"
                  values={{
                    homeFee: formatDZD(homeFee),
                    deskFee: formatDZD(deskFee),
                  }}
                  components={[<Ltr key="home" />, <Ltr key="desk" />]}
                />
              ) : (
                ""
              )}
            </span>
          </div>
          <div
            role="radiogroup"
            aria-label={t("delivery.modeLabel")}
            className="flex h-14 items-center gap-1 border border-(--sf-line) p-1"
            style={{ borderRadius: "var(--sf-radius)" }}
          >
            <button
              type="button"
              role="radio"
              aria-checked={stopDesk === 0}
              onClick={() => handleStopDeskChange(0)}
              className={cn(
                "flex h-full flex-1 items-center justify-center text-sm font-medium",
                stopDesk === 0
                  ? "bg-(--sf-ink) text-(--sf-ink-fg)"
                  : "text-(--sf-text)",
              )}
              style={{ borderRadius: "var(--sf-radius-sm)" }}
            >
              {t("delivery.home")}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={stopDesk === 1}
              disabled={!deskAvailable}
              onClick={() => handleStopDeskChange(1)}
              className={cn(
                "flex h-full flex-1 items-center justify-center text-sm font-medium",
                !deskAvailable
                  ? "cursor-not-allowed text-(--sf-muted)"
                  : stopDesk === 1
                    ? "bg-(--sf-ink) text-(--sf-ink-fg)"
                    : "text-(--sf-text)",
              )}
              style={{ borderRadius: "var(--sf-radius-sm)" }}
            >
              {t("delivery.desk")}
            </button>
          </div>
        </div>

        <div className="pt-2">
          <h3 className="pb-3 text-sm font-medium text-(--sf-text)">
            {t("summary.heading")}
          </h3>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-(--sf-muted)">{t("summary.price")}</span>
              <Ltr>
                {selectedSize ? formatDZD(productPrice) : t("summary.empty")}
              </Ltr>
            </div>
            <div className="flex justify-between">
              <span className="text-(--sf-muted)">{t("summary.delivery")}</span>
              {codeWilaya ? (
                hasTarif ? (
                  <Ltr>{formatDZD(fee)}</Ltr>
                ) : (
                  <span>{t("summary.calculating")}</span>
                )
              ) : (
                <Ltr>{t("summary.empty")}</Ltr>
              )}
            </div>
            <div className="my-4 border-t border-(--sf-text)" />
            <div className="flex justify-between font-medium">
              <span>{t("summary.total")}</span>
              <Ltr>{total > 0 ? formatDZD(total) : t("summary.empty")}</Ltr>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || (!!selectedSize && selectedSize.quantity === 0)}
          className={cn(
            "flex w-full items-center justify-center gap-2 py-4 text-sm font-medium transition-opacity hover:opacity-90 disabled:pointer-events-none md:text-lg",
            selectedSize
              ? "bg-(--sf-highlight) text-(--sf-highlight-fg)"
              : "bg-(--sf-line) text-(--sf-muted)",
          )}
          style={{ borderRadius: "var(--sf-radius)" }}
        >
          {loading ? (
            t("cta.loading")
          ) : selectedSize ? (
            <>
              {/* One flex item, so the button's gap-2 separates the label from
                  the arrow — not the price from the label. */}
              <span>
                <Trans
                  t={t}
                  i18nKey="cta.order"
                  values={{ total: formatDZD(total) }}
                  components={[<Ltr key="total" />]}
                />
              </span>
              {/* Points "forward", which is leftward in RTL. */}
              <ArrowRight
                className="h-4 w-4 rtl:-scale-x-100"
                strokeWidth={1.8}
              />
            </>
          ) : (
            t("cta.chooseSize")
          )}
        </button>

        <div className="flex items-center justify-center gap-4">
          <span className="flex items-center gap-1.5 text-xs text-(--sf-muted)">
            <Wallet
              className="h-3.5 w-3.5 text-(--sf-accent)"
              strokeWidth={1.8}
            />
            {t("reassurance.cod")}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-(--sf-muted)">
            <RotateCcw
              className="h-3.5 w-3.5 text-(--sf-accent)"
              strokeWidth={1.8}
            />
            {t("reassurance.exchange")}
          </span>
        </div>

        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 border border-(--sf-line) py-3.5 text-sm text-(--sf-text)"
          style={{ borderRadius: "var(--sf-radius)" }}
        >
          {t("cta.whatsapp")}
        </a>
      </div>

      {/* Mirrors the CTA above once it scrolls out of view on mobile. */}
      <div className="sf-glass fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t px-4 py-3 lg:hidden">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Ltr className="sf-heading text-lg font-medium text-(--sf-accent)">
            {total > 0 ? formatDZD(total) : t("summary.empty")}
          </Ltr>
          <span className="truncate text-[11px] text-(--sf-muted)">
            {selectedSize ? (
              <Trans
                t={t}
                i18nKey="sticky.size"
                values={{ size: selectedSize.size }}
                components={[<Ltr key="size" />]}
              />
            ) : (
              t("sticky.noSize")
            )}{" "}
            · {deliveryLabel}
          </span>
        </div>
        <button
          type="button"
          disabled={loading || (!!selectedSize && selectedSize.quantity === 0)}
          onClick={() => formRef.current?.requestSubmit()}
          className={cn(
            "shrink-0 px-5 py-3.5 text-sm font-medium disabled:pointer-events-none",
            selectedSize
              ? "bg-(--sf-highlight) text-(--sf-highlight-fg)"
              : "bg-(--sf-line) text-(--sf-muted)",
          )}
          style={{ borderRadius: "var(--sf-radius)" }}
        >
          {loading
            ? "…"
            : selectedSize
              ? t("cta.orderShort")
              : t("cta.chooseSizeShort")}
        </button>
      </div>
    </form>
  );
}
