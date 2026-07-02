import { relations } from "drizzle-orm"
import { index, integer, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { pgTable } from "drizzle-orm/pg-core"
import { users } from "../users"
import { worksites } from "../worksites"

export const permitTemplates = pgTable("permit_templates", {
  id:               text("id").primaryKey(),
  code:             text("code").notNull().unique(),
  title:            text("title").notNull(),
  riskType:         text("risk_type").notNull(),
  astFields:        jsonb("ast_fields").notNull(),
  validityHours:    integer("validity_hours"),
  requiresSignoff:  jsonb("requires_signoff").notNull(),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("permit_templates_risk_type_idx").on(table.riskType),
])

export const permitRequests = pgTable("permit_requests", {
  id:            text("id").primaryKey(),
  templateId:    text("template_id").notNull().references(() => permitTemplates.id),
  worksiteId:    text("worksite_id").notNull().references(() => worksites.id),
  requesterId:   text("requester_id").notNull().references(() => users.id),
  task:          text("task").notNull(),
  location:      text("location").notNull(),
  plannedStart:  timestamp("planned_start", { withTimezone: true, mode: "string" }).notNull(),
  plannedEnd:    timestamp("planned_end", { withTimezone: true, mode: "string" }).notNull(),
  ast:           jsonb("ast").notNull(),
  status:        text("status").notNull().default("solicitado"),
  approverId:    text("approver_id").references(() => users.id),
  executorId:    text("executor_id").references(() => users.id),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("permit_requests_ws_status_planned_idx").on(table.worksiteId, table.status, table.plannedStart),
])

export const permitSignoffs = pgTable("permit_signoffs", {
  id:        text("id").primaryKey(),
  permitId:  text("permit_id").notNull().references(() => permitRequests.id, { onDelete: "cascade" }),
  role:      text("role").notNull(),
  userId:    text("user_id").notNull().references(() => users.id),
  signedAt:  timestamp("signed_at", { withTimezone: true, mode: "string" }).notNull(),
  signature: text("signature").notNull(),
}, (table) => [
  uniqueIndex("permit_signoffs_permit_role_unique").on(table.permitId, table.role),
])

export const permitAttachments = pgTable("permit_attachments", {
  id:         text("id").primaryKey(),
  permitId:   text("permit_id").notNull().references(() => permitRequests.id, { onDelete: "cascade" }),
  kind:       text("kind").notNull(),
  url:        text("url").notNull(),
  uploadedBy: text("uploaded_by").notNull().references(() => users.id),
  createdAt:  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("permit_attachments_permit_kind_idx").on(table.permitId, table.kind),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const permitTemplatesRelations = relations(permitTemplates, ({ many }) => ({
  requests: many(permitRequests),
}))

export const permitRequestsRelations = relations(permitRequests, ({ one, many }) => ({
  template:  one(permitTemplates, { fields: [permitRequests.templateId], references: [permitTemplates.id] }),
  worksite:  one(worksites, { fields: [permitRequests.worksiteId], references: [worksites.id] }),
  requester: one(users, { fields: [permitRequests.requesterId], references: [users.id] }),
  approver:  one(users, { fields: [permitRequests.approverId], references: [users.id] }),
  executor:  one(users, { fields: [permitRequests.executorId], references: [users.id] }),
  signoffs:  many(permitSignoffs),
  attachments: many(permitAttachments),
}))

export const permitSignoffsRelations = relations(permitSignoffs, ({ one }) => ({
  permit: one(permitRequests, { fields: [permitSignoffs.permitId], references: [permitRequests.id] }),
  user:   one(users, { fields: [permitSignoffs.userId], references: [users.id] }),
}))

export const permitAttachmentsRelations = relations(permitAttachments, ({ one }) => ({
  permit:    one(permitRequests, { fields: [permitAttachments.permitId], references: [permitRequests.id] }),
  uploader:  one(users, { fields: [permitAttachments.uploadedBy], references: [users.id] }),
}))

/* ── Types ───────────────────────────────────────────────────────────────── */
export type PermitTemplate = typeof permitTemplates.$inferSelect
export type NewPermitTemplate = typeof permitTemplates.$inferInsert
export type PermitRequest = typeof permitRequests.$inferSelect
export type NewPermitRequest = typeof permitRequests.$inferInsert
export type PermitSignoff = typeof permitSignoffs.$inferSelect
export type NewPermitSignoff = typeof permitSignoffs.$inferInsert
export type PermitAttachment = typeof permitAttachments.$inferSelect
export type NewPermitAttachment = typeof permitAttachments.$inferInsert
