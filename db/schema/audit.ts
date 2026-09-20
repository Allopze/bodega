import { pgTable, text, integer, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core"
import { relations, sql } from "drizzle-orm"
import { users } from "./users"
import { worksites } from "./worksites"

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
  /**
   * La faena del hecho, cuando el hecho tiene una.
   *
   * Nace con la consolidación de los historiales por módulo de prevención
   * (2026-09-20): doce de esas tablas llevaban `worksite_id` propio y el alcance
   * por faena se filtra con él. Sin esta columna, la traza migrada perdería el
   * scoping y habría que derivarlo con un JOIN a una entidad que puede estar
   * borrada.
   *
   * `set null` y no `restrict`: la bitácora sobrevive a la faena, igual que
   * sobrevive al usuario —por eso `user_email` está denormalizado—. Una
   * auditoría que impide dar de baja una faena es una auditoría que alguien va
   * a querer borrar.
   */
  worksiteId:   text("worksite_id").references(() => worksites.id, { onDelete: "set null" }),
  ipAddress:    text("ip_address"),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("audit_log_created_at_idx").on(table.createdAt),
  /* `created_at` entra en el índice de entidad: la línea de tiempo de una
   * entidad se lee ordenada, y todas las tablas `*_history` que este log
   * reemplaza lo incluían. Sin él, el orden se resuelve en memoria. */
  index("audit_log_entity_idx").on(table.entityType, table.entityId, table.createdAt),
  index("audit_log_worksite_idx").on(table.worksiteId, table.createdAt),
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
  // `E2E-001` (auditoría 2026-09-14): la cadena tiene tres puntos donde el saldo
  // se recorta (cierre parcial de OC, rechazo/daño en recepción, diferencia al
  // cotejar una GDI) y ninguno se lo decía al solicitante, que sólo recibía
  // `receipt_done` cuando su ítem llegaba —completo— a oficina o a faena.
  | "request_item_shortfall"
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
  // Patrón P3 (auditoría 2026-09-14): tres vencimientos con consecuencia legal
  // que hasta entonces sólo se veían abriendo su pantalla.
  | "fleet_document_due_soon"
  | "fleet_document_overdue"
  | "risk_review_due_soon"
  | "risk_review_overdue"
  | "privacy_request_due_soon"
  | "privacy_request_overdue"
  | "ti_warranty_expiring"
  | "ti_license_renewal"
  | "ti_repair_stuck"
  | "ti_ticket_stale"
  // TIT-001 (auditoría 2026-09-14): la prioridad del ticket TI ahora gobierna
  // un plazo, y el plazo avisa por tramo como ya hacía Soporte.
  | "ti_ticket_sla_due_soon"
  | "ti_ticket_sla_overdue"
  | "ti_ticket_created"
  | "ti_ticket_assigned"
  | "ti_ticket_resolved"
  // Cierre mensual del Programa de Trabajo Preventivo por faena (Fase 4, G7):
  // la foto congelada del mes se distribuye a jefatura y responsables por
  // notificación y correo, con enlace al detalle del cierre y su descarga.
  | "pdtp_period_closed"

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
