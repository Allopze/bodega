import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { relations, sql } from "drizzle-orm"
import { users } from "./users"

/* ── Audit Log ────────────────────────────────────────────────────────────── */
export const auditLog = sqliteTable("audit_log", {
  id:           text("id").primaryKey(),
  userId:       text("user_id").references(() => users.id),
  userEmail:    text("user_email"),       // denormalized in case user is deleted
  action:       text("action").notNull(), // 'create' | 'update' | 'status_change' | 'delete'
  entityType:   text("entity_type").notNull(),  // 'purchase_request' | 'purchase_order' | etc.
  entityId:     text("entity_id").notNull(),
  entityCode:   text("entity_code"),      // human-readable code (SOL-2026-0001)
  oldState:     text("old_state"),        // JSON of relevant old values
  newState:     text("new_state"),        // JSON of relevant new values
  reason:       text("reason"),           // mandatory for rejections/postponements/cancellations
  ipAddress:    text("ip_address"),
  createdAt:    text("created_at").notNull().default(sql`(datetime('now'))`),
})

/* ── Status History ───────────────────────────────────────────────────────── */
export const statusHistory = sqliteTable("status_history", {
  id:           text("id").primaryKey(),
  entityType:   text("entity_type").notNull(),
  entityId:     text("entity_id").notNull(),
  fromStatus:   text("from_status"),
  toStatus:     text("to_status").notNull(),
  changedBy:    text("changed_by").references(() => users.id),
  reason:       text("reason"),
  changedAt:    text("changed_at").notNull().default(sql`(datetime('now'))`),
})

/* ── Attachments ─────────────────────────────────────────────────────────── */
export const attachments = sqliteTable("attachments", {
  id:           text("id").primaryKey(),
  entityType:   text("entity_type").notNull(),
  entityId:     text("entity_id").notNull(),
  fileName:     text("file_name").notNull(),
  filePath:     text("file_path").notNull(),
  fileSize:     integer("file_size"),
  mimeType:     text("mime_type"),
  uploadedBy:   text("uploaded_by").notNull().references(() => users.id),
  uploadedAt:   text("uploaded_at").notNull().default(sql`(datetime('now'))`),
})

/* ── Notifications ───────────────────────────────────────────────────────── */
export type NotificationType =
  | "request_submitted"
  | "request_approved"
  | "request_rejected"
  | "oc_created"
  | "receipt_done"
  | "dispatch_done"

export const notifications = sqliteTable("notifications", {
  id:           text("id").primaryKey(),
  userId:       text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type:         text("type").notNull(),  // NotificationType
  title:        text("title").notNull(),
  body:         text("body"),            // nullable — not all notifications have body text
  entityType:   text("entity_type"),
  entityId:     text("entity_id"),
  entityHref:   text("entity_href"),     // direct navigation link (e.g. /solicitudes/{id})
  isRead:       integer("is_read", { mode: "boolean" }).notNull().default(false),
  createdAt:    text("created_at").notNull().default(sql`(datetime('now'))`),
})

/* ── Relations ───────────────────────────────────────────────────────────── */
export const auditLogRelations = relations(auditLog, ({ one }) => ({
  user: one(users, { fields: [auditLog.userId], references: [users.id] }),
}))

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}))
