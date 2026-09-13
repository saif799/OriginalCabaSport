import { eq } from "drizzle-orm";

import { db, type Executor } from "@/lib/db";
import { appSettings } from "@/lib/schema";

/**
 * Reading and writing the admin-editable settings in `app_settings`.
 *
 * The table is a key/value store, so this module is where the keys are named
 * and where "never written" is turned into a usable value. Callers ask for a
 * setting and always get a string back; none of them handle a missing row.
 */

/** The WhatsApp template sent to a customer whose parcel is out for delivery. */
export const WHATSAPP_DELIVERY_MESSAGE_KEY = "whatsapp_delivery_message";

/**
 * One setting's value, or `fallback` if it has never been written.
 *
 * There is no "seed the defaults" step on purpose: a shop that has never
 * touched the template should get the current default, not whichever default
 * happened to be shipped the day its database was first migrated.
 */
export async function getSetting(
  key: string,
  fallback: string,
  exec: Executor = db,
): Promise<string> {
  const [row] = await (exec as typeof db)
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);
  return row?.value ?? fallback;
}

/** Writes one setting, inserting it the first time. */
export async function setSetting(
  key: string,
  value: string,
  exec: Executor = db,
): Promise<void> {
  await (exec as typeof db)
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}
