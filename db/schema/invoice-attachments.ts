import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core"
import { relations, sql } from "drizzle-orm"
import { users } from "./users"

// Reconciliation status values: "registered" | "observed" | "reconciled"
export type InvoiceReconciliationStatus = "registered" | "observed" | "reconciled"

export const invoiceAttachments = sqliteTable("invoice_attachments", {
  id:                   text("id").primaryKey(),
  targetType:           text("target_type").notNull(), // purchase_request | purchase_order
  targetId:             text("target_id").notNull(),
  invoiceNumber:        text("invoice_number").notNull(),
  invoiceDate:          text("invoice_date").notNull(),
  amount:               real("amount").notNull().default(0),
  fileName:             text("file_name").notNull(),
  storageName:          text("storage_name").notNull(),
  filePath:             text("file_path").notNull(),
  fileSize:             integer("file_size"),
  mimeType:             text("mime_type"),
  notes:                text("notes"),
  // Lightweight reconciliation (added after initial release)
  status:               text("status").notNull().default("registered"), // InvoiceReconciliationStatus
  reconciliationNotes:  text("reconciliation_notes"),
  reconciledAt:         text("reconciled_at"),
  reconciledBy:         text("reconciled_by").references(() => users.id),
  uploadedBy:           text("uploaded_by").notNull().references(() => users.id),
  uploadedAt:           text("uploaded_at").notNull().default(sql`(datetime('now'))`),
})

export const invoiceAttachmentsRelations = relations(invoiceAttachments, ({ one }) => ({
  uploader:   one(users, { fields: [invoiceAttachments.uploadedBy],   references: [users.id] }),
  reconciler: one(users, { fields: [invoiceAttachments.reconciledBy], references: [users.id] }),
}))
