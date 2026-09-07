"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Image from "next/image";
import { Trash2, Star, Archive, ArchiveRestore, GripVertical } from "lucide-react";
import { ACCEPTED_UPLOAD_ACCEPT_ATTR } from "@/lib/images/source";
import { uploadImageFile } from "@/lib/images/upload";

type Shoe = {
  id: string;
  color: string;
  priceOverride: number | null;
  compareAtPriceOverride: number | null;
  modelBasePrice: number;
  modelCompareAtPrice: number | null;
  modelName: string;
  archived: boolean;
};

type InventoryRow = {
  id: string;
  size: string;
  quantity: number;
  priceOverride: number | null;
};

type ImageRow = {
  id: string;
  cloudflareImageId: string;
  url: string;
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
};

export default function ProductEditClient({
  shoe,
  inventory,
  images: initialImages,
}: {
  shoe: Shoe;
  inventory: InventoryRow[];
  images: ImageRow[];
}) {
  const router = useRouter();
  const [priceOverride, setPriceOverride] = useState(
    shoe.priceOverride != null ? String(shoe.priceOverride) : ""
  );
  const [compareAtPriceOverride, setCompareAtPriceOverride] = useState(
    shoe.compareAtPriceOverride != null ? String(shoe.compareAtPriceOverride) : ""
  );
  const [overrides, setOverrides] = useState<Record<string, string>>(
    Object.fromEntries(
      inventory.map((i) => [i.id, i.priceOverride != null ? String(i.priceOverride) : ""])
    )
  );
  const [color, setColor] = useState(shoe.color);
  const [archived, setArchived] = useState(shoe.archived);
  const [savingDetails, setSavingDetails] = useState(false);
  const [images, setImages] = useState<ImageRow[]>(initialImages);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [pendingImageDelete, setPendingImageDelete] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSavePricing = async () => {
    setSaving(true);
    try {
      const priceOverrides = inventory.map((i) => ({
        inventoryId: i.id,
        priceOverride: overrides[i.id] ? Number(overrides[i.id]) : null,
      }));

      const res = await fetch(`/api/admin/products/${shoe.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceOverride: priceOverride ? Number(priceOverride) : null,
          compareAtPriceOverride: compareAtPriceOverride ? Number(compareAtPriceOverride) : null,
          priceOverrides,
        }),
      });

      if (res.ok) {
        toast.success("Pricing saved successfully!");
      } else {
        const err = await res.json();
        toast.error(err?.error || "Failed to save pricing");
      }
    } finally {
      setSaving(false);
    }
  };

  /** Sends a partial PATCH and reports the server's message on failure. */
  const patchShoe = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/products/${shoe.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || "Request failed");
    }
  };

  const handleSaveColor = async () => {
    const next = color.trim();
    if (!next) {
      toast.error("Colour cannot be empty");
      return;
    }
    setSavingDetails(true);
    try {
      await patchShoe({ color: next });
      setColor(next);
      toast.success("Colour saved");
    } catch (e: any) {
      toast.error(e?.message || "Failed to save colour");
    } finally {
      setSavingDetails(false);
    }
  };

  const handleToggleArchived = async () => {
    const next = !archived;
    setSavingDetails(true);
    try {
      await patchShoe({ archived: next });
      setArchived(next);
      toast.success(next ? "Product archived" : "Product restored");
      // revalidatePath in the route handler clears the server cache; this is
      // what makes the products list re-render with the new value.
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message || "Failed to update product");
    } finally {
      setSavingDetails(false);
    }
  };

  const handleUploadFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setUploading(true);
    let successCount = 0;
    // Seeded once from the current gallery, then advanced locally: `images` is a
    // stale closure for the whole loop, so reading it per file gave every upload
    // the same sortOrder (and isPrimary on an empty gallery).
    let nextSortOrder = images.reduce((max, img) => Math.max(max, img.sortOrder), -1) + 1;
    let hasPrimary = images.some((img) => img.isPrimary);

    for (const file of fileArray) {
      try {
        // Downscale, POST to /api/r2/upload for sharp to make the Renditions,
        // fall back to a presigned PUT of the original. Shared with the
        // Collections uploader so the two cannot drift (ADR-0007).
        const { key, url: publicUrl } = await uploadImageFile(file, {
          folder: `products/shoes/${shoe.id}`,
        });

        const claimPrimary = !hasPrimary;
        const registerRes = await fetch("/api/admin/images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shoeId: shoe.id,
            cloudflareImageId: key,
            url: publicUrl,
            sortOrder: nextSortOrder,
            isPrimary: claimPrimary,
          }),
        });

        if (!registerRes.ok) {
          const errJson = await registerRes.json().catch(() => ({}));
          throw new Error(errJson?.error || "Failed to register image");
        }

        const newImage: ImageRow = await registerRes.json();
        nextSortOrder++;
        if (newImage.isPrimary) hasPrimary = true;
        // The route unsets any other primary server-side; mirror that locally.
        setImages((prev) =>
          newImage.isPrimary
            ? [...prev.map((img) => ({ ...img, isPrimary: false })), newImage]
            : [...prev, newImage]
        );
        successCount++;
      } catch (err: any) {
        toast.error(`Upload failed for ${file.name}: ${err?.message || "Upload failed"}`);
      }
    }

    if (successCount > 0) {
      toast.success(
        `Successfully uploaded ${successCount} image${successCount > 1 ? "s" : ""}!`
      );
    }
    setUploading(false);
  };

  const handleDeleteImage = async (imageId: string) => {
    setPendingImageDelete(null);
    try {
      const res = await fetch("/api/admin/images", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId }),
      });
      if (res.ok) {
        setImages((prev) => prev.filter((img) => img.id !== imageId));
        toast.success("Image deleted");
      } else {
        toast.error("Failed to delete image");
      }
    } catch {
      toast.error("Failed to delete image");
    }
  };

  const handleSetPrimary = async (imageId: string) => {
    const updated = images.map((img) => ({
      ...img,
      isPrimary: img.id === imageId,
    }));
    setImages(updated);

    try {
      const res = await fetch(`/api/admin/products/${shoe.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageSortOrders: updated.map((img) => ({
            imageId: img.id,
            sortOrder: img.sortOrder,
            isPrimary: img.isPrimary,
          })),
        }),
      });
      if (res.ok) toast.success("Primary image updated");
      else toast.error("Failed to update primary image");
    } catch {
      toast.error("Failed to update primary image");
    }
  };

  const persistImageOrder = async (ordered: ImageRow[]) => {
    try {
      const res = await fetch(`/api/admin/products/${shoe.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageSortOrders: ordered.map((img, i) => ({
            imageId: img.id,
            sortOrder: i,
            isPrimary: img.isPrimary,
          })),
        }),
      });
      if (!res.ok) toast.error("Failed to save image order");
    } catch {
      toast.error("Failed to save image order");
    }
  };

  const handleDropImage = (targetId: string) => {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      return;
    }
    const fromIndex = images.findIndex((i) => i.id === draggingId);
    const toIndex = images.findIndex((i) => i.id === targetId);
    setDraggingId(null);
    if (fromIndex === -1 || toIndex === -1) return;

    const next = [...images];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    const reindexed = next.map((img, i) => ({ ...img, sortOrder: i }));
    setImages(reindexed);
    persistImageOrder(reindexed);
  };

  return (
    <div className="space-y-10">
      {/* Details Section */}
      <section className="space-y-4 border rounded-lg p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">Details</h2>
          <Button
            variant={archived ? "secondary" : "outline"}
            size="sm"
            onClick={handleToggleArchived}
            disabled={savingDetails}
          >
            {archived ? (
              <>
                <ArchiveRestore className="mr-2 h-4 w-4" /> Restore
              </>
            ) : (
              <>
                <Archive className="mr-2 h-4 w-4" /> Archive
              </>
            )}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {archived
            ? "Archived: hidden from the catalog, the sitemap and the arrivage picker. Stock and the direct product link are unaffected."
            : "Rename the colour of this variant. The model name is edited from the products list."}
        </p>
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-2">
            <Label>Colour</Label>
            <Input
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="e.g. Triple Black"
            />
          </div>
          <Button
            onClick={handleSaveColor}
            disabled={savingDetails || color.trim() === shoe.color}
          >
            {savingDetails ? "Saving..." : "Save Colour"}
          </Button>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="space-y-6 border rounded-lg p-6">
        <h2 className="text-lg font-semibold">Pricing</h2>
        <p className="text-sm text-muted-foreground">
          Model price: {shoe.modelBasePrice} DA
          {shoe.modelCompareAtPrice != null ? ` (compare-at ${shoe.modelCompareAtPrice} DA)` : ""}.
          Leave the fields below blank to inherit it.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Price override for this colour (DA)</Label>
            <Input
              type="number"
              min={0}
              placeholder={String(shoe.modelBasePrice)}
              value={priceOverride}
              onChange={(e) => setPriceOverride(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Compare-at override (DA) — optional</Label>
            <Input
              type="number"
              min={0}
              placeholder={shoe.modelCompareAtPrice != null ? String(shoe.modelCompareAtPrice) : "None"}
              value={compareAtPriceOverride}
              onChange={(e) => setCompareAtPriceOverride(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">
            Per-Size Price Overrides
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {inventory.map((inv) => (
              <div key={inv.id} className="space-y-1">
                <Label className="text-xs">
                  Size {inv.size}{" "}
                  <span className="text-muted-foreground">
                    (qty: {inv.quantity})
                  </span>
                </Label>
                <Input
                  type="number"
                  min={0}
                  placeholder="No override"
                  value={overrides[inv.id] ?? ""}
                  onChange={(e) =>
                    setOverrides((prev) => ({
                      ...prev,
                      [inv.id]: e.target.value,
                    }))
                  }
                />
              </div>
            ))}
          </div>
        </div>

        <Button onClick={handleSavePricing} disabled={saving}>
          {saving ? "Saving..." : "Save Pricing"}
        </Button>
      </section>

      {/* Image Gallery Section */}
      <section className="space-y-6 border rounded-lg p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Image Gallery</h2>
          {images.length > 1 && (
            <p className="text-xs text-muted-foreground">Drag to reorder</p>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {images.map((img) => (
            <div
              key={img.id}
              draggable
              onDragStart={() => setDraggingId(img.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDropImage(img.id)}
              onDragEnd={() => setDraggingId(null)}
              className={`relative group rounded-lg overflow-hidden border cursor-grab active:cursor-grabbing transition-opacity ${
                draggingId === img.id ? "opacity-40" : ""
              }`}
            >
              <div className="absolute top-2 right-2 z-10 bg-black/60 rounded p-1 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                <GripVertical className="h-4 w-4" />
              </div>
              <Image
                src={img.url}
                alt={img.altText ?? `${shoe.modelName} ${shoe.color}`}
                width={300}
                height={300}
                className="object-cover w-full aspect-square pointer-events-none"
              />
              {img.isPrimary && (
                <span className="absolute top-2 left-2 bg-yellow-400 text-black text-xs font-bold px-2 py-0.5 rounded">
                  Primary
                </span>
              )}
              <div className="absolute bottom-0 inset-x-0 bg-black/60 flex gap-2 p-2">
                {!img.isPrimary && (
                  <button
                    onClick={() => handleSetPrimary(img.id)}
                    className="text-yellow-400 hover:text-yellow-300"
                    title="Set as primary"
                  >
                    <Star className="h-4 w-4" />
                  </button>
                )}
                <button
                  onClick={() => setPendingImageDelete(img.id)}
                  className="text-red-400 hover:text-red-300"
                  title="Delete image"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_UPLOAD_ACCEPT_ATTR}
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) {
                handleUploadFiles(e.target.files);
              }
              e.target.value = "";
            }}
          />
          <Button
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? "Uploading..." : "Upload Image"}
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={pendingImageDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingImageDelete(null);
        }}
        title="Delete this image?"
        description="It is removed from the gallery and from R2. This is permanent."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (pendingImageDelete) handleDeleteImage(pendingImageDelete);
        }}
      />
    </div>
  );
}
