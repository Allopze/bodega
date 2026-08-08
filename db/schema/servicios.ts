import { relations, sql } from "drizzle-orm"
import { pgTable, text, timestamp, numeric, check, uniqueIndex, index } from "drizzle-orm/pg-core"
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
  // Invariant (LOG-4/DAT-4): a lo sumo una cotización ganadora por solicitud.
  uniqueIndex("service_quotations_one_selected").on(table.requestId).where(sql`${table.status} = 'selected'`),
  // DAT-11: la unique de arriba es parcial (sólo status='selected') y no sirve
  // para el query general "todas las cotizaciones de esta solicitud" — FK sin
  // índice completo.
  index("service_quotations_request_id_idx").on(table.requestId),
])

/* ── Relations ────────────────────────────────────────────────────────────────── */
export const serviceQuotationsRelations = relations(serviceQuotations, ({ one }) => ({
  request:       one(purchaseRequests, { fields: [serviceQuotations.requestId], references: [purchaseRequests.id] }),
  supplier:      one(suppliers, { fields: [serviceQuotations.supplierId], references: [suppliers.id] }),
  uploadedByUser: one(users, { fields: [serviceQuotations.uploadedBy], references: [users.id] }),
  decidedByUser: one(users, { fields: [serviceQuotations.decidedBy], references: [users.id] }),
}))
