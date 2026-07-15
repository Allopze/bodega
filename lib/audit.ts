import { sql } from "drizzle-orm"
import { db, type DB } from "@/db"
import { auditLog, statusHistory } from "@/db/schema"
import { nanoid } from "./id"

type AuditDb = Pick<DB, "insert">

interface AuditParams {
  userId:     string | null
  userEmail?: string
  action:     "create" | "update" | "status_change" | "delete" | "cancel" | "login" | "export"
  entityType: string
  entityId:   string
  entityCode?: string
  oldState?:  Record<string, unknown>
  newState?:  Record<string, unknown>
  reason?:    string
  ipAddress?: string
}

/**
 * Record an audit log entry.
 * Must be called from service layer, never from UI components.
 */
export async function recordAudit(params: AuditParams, client: AuditDb = db): Promise<void> {
  await client.insert(auditLog).values({
    id:         nanoid(),
    userId:     params.userId,
    userEmail:  params.userEmail,
    action:     params.action,
    entityType: params.entityType,
    entityId:   params.entityId,
    entityCode: params.entityCode,
    oldState:   params.oldState ? JSON.stringify(params.oldState) : null,
    newState:   params.newState ? JSON.stringify(params.newState) : null,
    reason:     params.reason,
    ipAddress:  params.ipAddress,
  })
}

interface StatusChangeParams {
  entityType: string
  entityId:   string
  fromStatus: string | null
  toStatus:   string
  changedBy:  string | null
  reason?:    string
}

/**
 * Record a status transition in the status history table.
 * Call alongside recordAudit for every state machine transition.
 */
export async function recordStatusChange(params: StatusChangeParams, client: AuditDb = db): Promise<void> {
  await client.insert(statusHistory).values({
    id:         nanoid(),
    entityType: params.entityType,
    entityId:   params.entityId,
    fromStatus: params.fromStatus,
    toStatus:   params.toStatus,
    changedBy:  params.changedBy,
    reason:     params.reason,
  })
}

/**
 * Bulk-insert multiple status changes in a single round-trip.
 * Use for loops of recordStatusChange to reduce DB overhead.
 */
export async function recordStatusChanges(paramsList: StatusChangeParams[], client: AuditDb = db): Promise<void> {
  if (paramsList.length === 0) return
  await client.insert(statusHistory).values(
    paramsList.map((params) => ({
      id:         nanoid(),
      entityType: params.entityType,
      entityId:   params.entityId,
      fromStatus: params.fromStatus,
      toStatus:   params.toStatus,
      changedBy:  params.changedBy,
      reason:     params.reason,
    })),
  )
}

/* ── DB-03: Archival / retention ─────────────────────────────────────────────
 *
 * DS N°44/2024 + Ley 16.744: occupational safety records must be kept ≥ 5 years.
 * Default retention is 6 years (1-year buffer above the legal minimum).
 *
 * Call from an admin action or scheduled job. Never call automatically on every
 * request — this is a maintenance operation.
 */

/**
 * Deletes audit_log entries older than `keepYears` years.
 * Minimum allowed value is 5 (legal requirement).
 * Returns the number of rows deleted.
 */
export async function cleanupOldAuditLog(keepYears = 6): Promise<number> {
  if (keepYears < 5) throw new Error("keepYears must be ≥ 5 (legal requirement DS N°44/2024)")
  const [row] = await db.execute<{ cleanup_old_audit_log: string }>(
    sql`SELECT cleanup_old_audit_log(${keepYears})`
  )
  return parseInt(row?.cleanup_old_audit_log ?? "0", 10)
}

/**
 * Moves inventory_movements rows older than `keepMonths` months to the archive table.
 * Returns the number of rows archived.
 */
export async function archiveOldInventoryMovements(keepMonths = 36): Promise<number> {
  const [row] = await db.execute<{ archive_old_inventory_movements: string }>(
    sql`SELECT archive_old_inventory_movements(${keepMonths})`
  )
  return parseInt(row?.archive_old_inventory_movements ?? "0", 10)
}
