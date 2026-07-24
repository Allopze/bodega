import { lt } from "drizzle-orm"
import { db } from "@/db"
import { passwordResetTokens } from "@/db/schema"

/**
 * Cleanup: delete expired or used tokens older than 7 days.
 * Server-only — deliberately NOT a "use server" action. Meant to run from a
 * cron/background job, never as a client-invokable server action.
 */
export async function pruneResetTokens(): Promise<void> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  await db
    .delete(passwordResetTokens)
    .where(lt(passwordResetTokens.createdAt, cutoff))
}
