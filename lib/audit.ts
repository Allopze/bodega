import { db, type DB } from "@/db"
import { auditLog, statusHistory } from "@/db/schema"
import { nanoid } from "./id"

type AuditDb = Pick<DB, "insert">

interface AuditParams {
  userId:     string | null
  userEmail?: string
  action:     "create" | "update" | "status_change" | "delete" | "login"
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
