import { relations, sql } from "drizzle-orm"
import { pgTable, text, timestamp, numeric, check } from "drizzle-orm/pg-core"
import { purchaseRequests } from "./requests"
import { users } from "./users"
import { suppliers } from "./worksites"

/* ── Service Quotation States ─────────────────────────────────────────────────── */
// pending | selected | rejected

/* ── Service Quotations ───────────────────────────────────────────────────────── */
// One solicitud de servicios can have 1..N cotizaciones.
// Exactly one becomes 'selected' when the jefa approves it; the rest become 'rejected'.
// The actual file is stored in storage/servicios/.
export const serviceQuotations = pgTable("service_quotations", {
  id:               text("id").primaryKey(),
  requestId:        text("request_id").notNull().references(() => purchaseRequests.id, { onDelete: "cascade" }),
  // Supplier: either a catalog supplier or free-text name
  supplierId:       text("supplier_id").references(() => suppliers.id),
  supplierNameFree: text("supplier_name_free"),
  // File info stored here; the actual blob is served from storage/servicios/
  fileName:         text("file_name").notNull(),
  filePath:         text("file_path").notNull(),
  fileSize:         text("file_size"),
  uploadedBy:       text("uploaded_by").references(() => users.id),
  // Quoted total (shown to the jefa during selection)
  totalAmount:      numeric("total_amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
  status:           text("status").notNull().default("pending"), // pending | selected | rejected
  notes:            text("notes"),
  // Approval trace
  decidedBy:        text("decided_by").references(() => users.id),
  selectedAt:       text("selected_at"),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  // Invariant: status from canonical set
  check("service_quotations_status_valid", sql`
    ${table.status} IN ('pending', 'selected', 'rejected')
  `),
])

/* ── Relations ────────────────────────────────────────────────────────────────── */
export const serviceQuotationsRelations = relations(serviceQuotations, ({ one }) => ({
  request:       one(purchaseRequests, { fields: [serviceQuotations.requestId], references: [purchaseRequests.id] }),
  supplier:      one(suppliers, { fields: [serviceQuotations.supplierId], references: [suppliers.id] }),
  uploadedByUser: one(users, { fields: [serviceQuotations.uploadedBy], references: [users.id] }),
  decidedByUser: one(users, { fields: [serviceQuotations.decidedBy], references: [users.id] }),
}))
