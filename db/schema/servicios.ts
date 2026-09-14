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
  /**
   * COT-004: el MIME que la validación por bytes mágicos declaró al cargar.
   * Antes se descartaba y la descarga adivinaba por la extensión del nombre
   * que mandó el cliente, así que toda imagen válida salía como binario
   * genérico. NULL sólo en las filas anteriores a la migración 0306.
   */
  mimeType:         text("mime_type"),
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
  // COT-004: nunca se sirve desde el origen de la aplicación un tipo que la
  // carga no acepta. Una validación que sólo viviera en zod no protege a un
  // camino de escritura futuro.
  check("service_quotations_mime_type_valid", sql`
    ${table.mimeType} IS NULL OR ${table.mimeType} IN ('application/pdf', 'image/jpeg', 'image/png')
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
