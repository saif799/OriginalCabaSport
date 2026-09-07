import { requireAdmin } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { storefrontCollections } from "@/lib/schema";
import { buildR2PublicUrl } from "@/lib/r2";
import { deleteRenditions } from "@/lib/images/transform";
import { collectionSlug } from "@/lib/storefront/collections";
import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";

type Params = { params: Promise<{ collectionId: string }> };

/**
 * Best-effort removal of the R2 objects we have just stopped pointing at —
 * three Renditions since ADR-0007, or the single file of an image uploaded
 * before it.
 *
 * Unlike `DELETE /api/admin/images`, which deletes from R2 *first* and keeps
 * the row if that fails, a failed delete here must not fail the edit: the DB is
 * already correct, and the worst case is one orphaned object in the bucket. The
 * opposite order would leave the admin unable to change an image because of a
 * bucket problem that has nothing to do with the change.
 */
async function discardR2Object(key: string | null | undefined) {
  if (!key) return;
  try {
    await deleteRenditions(key);
  } catch (error) {
    console.warn(`Failed to delete replaced R2 objects for "${key}":`, error);
  }
}

/**
 * PATCH /api/admin/collections/[collectionId] — rename, re-describe, re-slug,
 * show/hide, and set or clear the image.
 *
 * `imageUrl` is derived here from `imageKey` and is never read off the body, so
 * the R2 object key stays the single source of truth exactly as it is for
 * `shoeImages.cloudflareImageId` (see POST /api/admin/images).
 */
export async function PATCH(request: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { collectionId } = await params;
  try {
    const body = await request.json();
    const { title, subtitle, slug, isVisible, imageKey, imageAlt } = body;

    // Same guard as POST: a Collection with no title has nothing to render on
    // its card, and the field is the only thing the slug ever came from.
    if (title !== undefined && !String(title).trim()) {
      return NextResponse.json({ error: "Title cannot be empty" }, { status: 400 });
    }

    const [existing] = await db
      .select()
      .from(storefrontCollections)
      .where(eq(storefrontCollections.id, collectionId))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }

    // A slug edit is deliberate and rare — normalise it the same way creation
    // does, and refuse a collision rather than letting the DB 500.
    let nextSlug: string | undefined;
    if (slug !== undefined) {
      nextSlug = collectionSlug(String(slug));
      const [clash] = await db
        .select({ id: storefrontCollections.id })
        .from(storefrontCollections)
        .where(
          and(eq(storefrontCollections.slug, nextSlug), ne(storefrontCollections.id, collectionId)),
        )
        .limit(1);
      if (clash) {
        return NextResponse.json({ error: `Slug "${nextSlug}" is already taken` }, { status: 409 });
      }
    }

    const nextImageKey: string | null | undefined =
      imageKey === undefined ? undefined : imageKey ? String(imageKey) : null;

    const [updated] = await db
      .update(storefrontCollections)
      .set({
        ...(title !== undefined ? { title: String(title).trim() } : {}),
        ...(subtitle !== undefined ? { subtitle: subtitle ? String(subtitle).trim() : null } : {}),
        ...(nextSlug !== undefined ? { slug: nextSlug } : {}),
        ...(isVisible !== undefined ? { isVisible: Boolean(isVisible) } : {}),
        ...(imageAlt !== undefined ? { imageAlt: imageAlt ? String(imageAlt).trim() : null } : {}),
        ...(nextImageKey !== undefined
          ? {
              imageKey: nextImageKey,
              imageUrl: nextImageKey ? buildR2PublicUrl(nextImageKey) : null,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(storefrontCollections.id, collectionId))
      .returning();

    // Only once the row no longer references it.
    if (nextImageKey !== undefined && existing.imageKey && existing.imageKey !== nextImageKey) {
      await discardR2Object(existing.imageKey);
    }

    revalidatePath("/[lng]", "layout");
    revalidatePath("/admin/collections");
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/collections/[collectionId] — cascades to its picks, and
 * takes the Collection's R2 object with it (nothing else references it).
 */
export async function DELETE(_request: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { collectionId } = await params;
  try {
    const [deleted] = await db
      .delete(storefrontCollections)
      .where(eq(storefrontCollections.id, collectionId))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }

    await discardR2Object(deleted.imageKey);

    revalidatePath("/[lng]", "layout");
    revalidatePath("/admin/collections");
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message }, { status: 500 });
  }
}
