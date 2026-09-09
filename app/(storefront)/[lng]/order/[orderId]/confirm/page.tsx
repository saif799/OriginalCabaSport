import { db } from "@/lib/db";
import { ordersTable, orderItems, shoeInventory, shoes, shoeModels } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, MessageCircle } from "lucide-react";
import { formatDZD } from "@/lib/format";
import PurchaseTracker from "@/components/storefront/PurchaseTracker";
import { getPurchaseContents } from "@/lib/storefront/purchaseContents";
import Ltr from "@/components/storefront/Ltr";
import { getT } from "@/app/i18n/server";
import { isLocale, localePath } from "@/i18n.config";

type Props = { params: Promise<{ lng: string; orderId: string }> };

export async function generateMetadata({ params }: Props) {
  const { lng } = await params;
  if (!isLocale(lng)) return {};
  const { t } = await getT(lng, "checkout");
  return {
    title: t("confirm.metaTitle"),
    // A receipt is per-customer and must never be indexed.
    robots: { index: false, follow: false },
  };
}

export default async function OrderConfirmPage({ params }: Props) {
  const { lng, orderId } = await params;
  if (!isLocale(lng)) notFound();
  const { t } = await getT(lng, "checkout");

  const [order] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId))
    .limit(1);

  if (!order) notFound();

  const items = await db
    .select({
      inventoryId: shoeInventory.id,
      size: shoeInventory.size,
      color: shoes.color,
      modelName: shoeModels.modelName,
    })
    .from(orderItems)
    .innerJoin(shoeInventory, eq(orderItems.shoeInventoryId, shoeInventory.id))
    .innerJoin(shoes, eq(shoeInventory.shoeId, shoes.id))
    .innerJoin(shoeModels, eq(shoes.modelId, shoeModels.id))
    .where(eq(orderItems.orderId, orderId));

  // Merchandise value for the pixel, resolved by the same helper the server's
  // Conversions API call uses — the two events are deduplicated into one, so
  // they must agree on what the sale was worth. A second query rather than
  // more columns on the one above: the confirmation page is not a hot path,
  // and one copy of the pricing rule is worth more than one round trip.
  const pixelId = process.env.FB_PIXEL_ID;
  const {
    contents: pixelContents,
    contentIds: pixelContentIds,
    value: pixelValue,
  } = await getPurchaseContents(orderId);

  const total = formatDZD(Number(order.montant));

  // Translated, because a customer who read the whole checkout in Arabic and
  // is then handed a pre-filled French message has hit exactly the confusion
  // this locale exists to remove. The order's own values stay verbatim, so the
  // shop can still read the details at a glance either way.
  const whatsappMessage = encodeURIComponent(
    t("confirm.whatsappMessage", {
      reference: order.reference || orderId,
      name: order.nom_client,
      total,
    }),
  );
  const whatsappNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "213XXXXXXXXX";
  const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${whatsappMessage}`;

  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      {pixelId && (
        <PurchaseTracker
          pixelId={pixelId}
          eventId={orderId}
          value={pixelValue}
          contentIds={pixelContentIds}
          contents={pixelContents}
          phone={order.telephone}
        />
      )}
      <div className="flex flex-col items-center gap-5 text-center">
        <CheckCircle2 className="h-14 w-14 text-green-600" strokeWidth={1.5} />
        <div>
          <h1 className="sf-heading text-xl font-medium text-green-600 md:text-2xl">
            {t("confirm.heading")}
          </h1>
          <p className="sf-body mt-2 text-sm font-normal text-(--sf-muted)">
            {t("confirm.subheading", { name: order.nom_client })}
          </p>
        </div>
      </div>

      <div className="sf-body mt-8 space-y-4 text-sm">
        <div className="space-y-3 pt-4">
          <p className="font-medium">{t("confirm.items")}</p>
          {items.map((item) => (
            <div key={item.inventoryId} className="flex justify-between">
              {/* Catalog Data — verbatim, in an LTR isolate. */}
              <Ltr>
                {item.modelName} — {item.color}
              </Ltr>
              {/* Both locales put the label before the number, so this needs
                  no <Trans> reordering — only the value needs isolating. */}
              <span className="text-(--sf-text)">
                {t("confirm.size")} <Ltr>{item.size}</Ltr>
              </span>
            </div>
          ))}
        </div>

        <div className="space-y-2 border-t border-(--sf-line) pt-4">
          <div className="flex justify-between">
            <span className="text-(--sf-text)">{t("confirm.delivery")}</span>
            <span>
              <Ltr>{order.commune}</Ltr>, {t("confirm.wilaya")}{" "}
              <Ltr>{order.code_wilaya}</Ltr>
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-(--sf-text)">{t("confirm.phone")}</span>
            <Ltr>{order.telephone}</Ltr>
          </div>
        </div>

        <div className="my-4 border-t border-(--sf-text)" />
        <div className="flex justify-between font-medium">
          <span>{t("confirm.total")}</span>
          <Ltr className="text-(--sf-text)">{total}</Ltr>
        </div>
      </div>

      <div className="mt-8 flex flex-col gap-3">
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 bg-green-600 py-4 text-sm font-medium text-(--sf-ink-fg) transition-opacity hover:opacity-90"
          style={{ borderRadius: "var(--sf-radius)" }}
        >
          <MessageCircle className="h-4 w-4" strokeWidth={1.5} />
          {t("confirm.whatsappCta")}
        </a>
        <Link
          href={localePath(lng, "/products")}
          className="flex w-full items-center justify-center border border-(--sf-line) py-4 text-sm font-medium text-(--sf-text) transition-colors hover:bg-(--sf-hover)"
          style={{ borderRadius: "var(--sf-radius)" }}
        >
          {t("confirm.continue")}
        </Link>
      </div>
    </main>
  );
}
