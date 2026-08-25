import { pgTable, text, integer, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core"
import { relations, sql } from "drizzle-orm"
import { users } from "./users"

/* ── Audit Log ────────────────────────────────────────────────────────────── */
export const auditLog = pgTable("audit_log", {
  id:           text("id").primaryKey(),
  userId:       text("user_id").references(() => users.id),
  userEmail:    text("user_email"),       // denormalized in case user is deleted
  action:       text("action").notNull(), // 'create' | 'update' | 'status_change' | 'delete'
  entityType:   text("entity_type").notNull(),  // 'purchase_request' | 'purchase_order' | etc.
  entityId:     text("entity_id").notNull(),
  entityCode:   text("entity_code"),      // human-readable code (SOL-0001)
  oldState:     text("old_state"),        // JSON of relevant old values
  newState:     text("new_state"),        // JSON of relevant new values
  reason:       text("reason"),           // mandatory for rejections/postponements/cancellations
  ipAddress:    text("ip_address"),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("audit_log_created_at_idx").on(table.createdAt),
  index("audit_log_entity_idx").on(table.entityType, table.entityId),
])

/* ── Status History ───────────────────────────────────────────────────────── */
export const statusHistory = pgTable("status_history", {
  id:           text("id").primaryKey(),
  entityType:   text("entity_type").notNull(),
  entityId:     text("entity_id").notNull(),
  fromStatus:   text("from_status"),
  toStatus:     text("to_status").notNull(),
  changedBy:    text("changed_by").references(() => users.id),
  reason:       text("reason"),
  changedAt:    timestamp("changed_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("status_history_entity_idx").on(table.entityType, table.entityId, table.changedAt),
])

/* ── Attachments ─────────────────────────────────────────────────────────── */
export const attachments = pgTable("attachments", {
  id:           text("id").primaryKey(),
  entityType:   text("entity_type").notNull(),
  entityId:     text("entity_id").notNull(),
  fileName:     text("file_name").notNull(),
  filePath:     text("file_path").notNull(),
  fileSize:     integer("file_size"),
  mimeType:     text("mime_type"),
  uploadedBy:   text("uploaded_by").notNull().references(() => users.id),
  uploadedAt:   timestamp("uploaded_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
})

/* ── Notifications ───────────────────────────────────────────────────────── */
export type NotificationType =
  | "request_submitted"
  | "request_approved"
  | "request_rejected"
  | "oc_created"
  | "oc_sent"
  | "receipt_done"
  | "dispatch_done"
  | "ppa_stopped"
  | "ppa_pending_review"
  | "ppa_authorized"
  | "ppa_rejected"
  | "feedback_submitted"
  | "feedback_status_updated"
  | "feedback_sla_due_soon"
  | "feedback_sla_overdue"
  | "system_alert"
  | "fuel_statement_due_soon"
  | "fuel_statement_overdue"
  | "fuel_loads_unassigned"
  | "sst_document_expiring"
  | "sst_document_expired"
  | "maintenance_due_soon"
  | "maintenance_overdue"

export const notifications = pgTable("notifications", {
  id:           text("id").primaryKey(),
  userId:       text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type:         text("type").notNull(),  // NotificationType
  title:        text("title").notNull(),
  body:         text("body"),            // nullable — not all notifications have body text
  entityType:   text("entity_type"),
  entityId:     text("entity_id"),
  entityHref:   text("entity_href"),     // direct navigation link (e.g. /solicitudes/{id})
  isRead:       boolean("is_read").notNull().default(false),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  /**
   * Llave opcional para deduplicación. Cuando se setea, sólo puede
   * existir una notificación con esa llave por (userId). Útil para
   * recordatorios recurrentes (cron PDTP) que no deben spamear al
   * destinatario. Índice único parcial al final.
   */
  dedupeKey:    text("dedupe_key"),
}, (table) => [
  index("notifications_user_read_idx").on(table.userId, table.isRead, table.createdAt),
  uniqueIndex("notifications_user_dedupe_unique").on(table.userId, table.dedupeKey).where(sql`${table.dedupeKey} IS NOT NULL`),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user: one(users, { fields: [auditLog.userId], references: [users.id] }),
}))

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}))
