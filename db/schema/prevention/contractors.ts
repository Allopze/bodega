import { relations } from "drizzle-orm"
import { index, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { pgTable } from "drizzle-orm/pg-core"
import { workers } from "../worksites"

export const contractors = pgTable("contractors", {
  id:                 text("id").primaryKey(),
  rut:                text("rut").notNull().unique(),
  name:               text("name").notNull(),
  legalRepresentative: text("legal_representative"),
  contact:            text("contact"),
  status:             text("status").notNull().default("activo"),
  createdAt:          timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:          timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
})

export const contractorWorkers = pgTable("contractor_workers", {
  id:           text("id").primaryKey(),
  contractorId: text("contractor_id").notNull().references(() => contractors.id, { onDelete: "cascade" }),
  workerId:     text("worker_id").notNull().references(() => workers.id),
  position:     text("position").notNull(),
  startDate:    text("start_date").notNull(),
  endDate:      text("end_date"),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:    timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("contractor_workers_contractor_end_idx").on(table.contractorId, table.endDate),
])

export const contractorDocuments = pgTable("contractor_documents", {
  id:           text("id").primaryKey(),
  contractorId: text("contractor_id").notNull().references(() => contractors.id, { onDelete: "cascade" }),
  type:         text("type").notNull(),
  versionId:    text("version_id"),
  status:       text("status").notNull().default("pendiente"),
  expiresAt:    text("expires_at"),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt:    timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  index("contractor_documents_contractor_type_expires_idx").on(table.contractorId, table.type, table.expiresAt),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const contractorsRelations = relations(contractors, ({ many }) => ({
  workers:   many(contractorWorkers),
  documents: many(contractorDocuments),
}))

export const contractorWorkersRelations = relations(contractorWorkers, ({ one }) => ({
  contractor: one(contractors, { fields: [contractorWorkers.contractorId], references: [contractors.id] }),
  worker:     one(workers, { fields: [contractorWorkers.workerId], references: [workers.id] }),
}))

export const contractorDocumentsRelations = relations(contractorDocuments, ({ one }) => ({
  contractor: one(contractors, { fields: [contractorDocuments.contractorId], references: [contractors.id] }),
}))

/* ── Types ───────────────────────────────────────────────────────────────── */
export type Contractor = typeof contractors.$inferSelect
export type NewContractor = typeof contractors.$inferInsert
export type ContractorWorker = typeof contractorWorkers.$inferSelect
export type NewContractorWorker = typeof contractorWorkers.$inferInsert
export type ContractorDocument = typeof contractorDocuments.$inferSelect
export type NewContractorDocument = typeof contractorDocuments.$inferInsert
