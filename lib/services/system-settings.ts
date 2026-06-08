import { db } from "@/db"
import { systemSettings } from "@/db/schema"
import { eq } from "drizzle-orm"
import { recordAudit } from "@/lib/audit"

/**
 * Get the configured maximum PDF file size upload limit in MB.
 * Defaults to 10 MB if not set or invalid.
 */
export async function getPdfMaxSizeMb(): Promise<number> {
  try {
    const setting = await db.query.systemSettings.findFirst({
      where: eq(systemSettings.key, "pdf_max_size_mb"),
    })
    if (setting) {
      const val = parseInt(setting.value, 10)
      if (!isNaN(val) && val > 0) {
        return val
      }
    }
  } catch (err) {
    console.error("Error fetching pdf_max_size_mb setting, using default 10MB:", err)
  }
  return 10
}

/**
 * Set the maximum PDF file size upload limit in MB.
 * Updates the database and logs the action to the audit log.
 */
export async function setPdfMaxSizeMb(
  value: number,
  userId: string,
  userEmail?: string,
): Promise<void> {
  const oldValue = await getPdfMaxSizeMb()
  const valStr = value.toString()

  await db
    .insert(systemSettings)
    .values({
      key: "pdf_max_size_mb",
      value: valStr,
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: {
        value: valStr,
        updatedAt: new Date().toISOString(),
      },
    })

  recordAudit({
    userId,
    userEmail,
    action: "update",
    entityType: "system_setting",
    entityId: "pdf_max_size_mb",
    oldState: { value: oldValue },
    newState: { value },
  })
}
