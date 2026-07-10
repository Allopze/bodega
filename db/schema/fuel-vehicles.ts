import { pgTable, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { worksites } from "./worksites"
import { fuelLoads } from "./fuel-invoices"
import { users } from "./users"

/* ── Fuel Vehicles (catálogo propio del módulo combustibles) ─────────────── */
export const fuelVehicles = pgTable("fuel_vehicles", {
  id:        text("id").primaryKey(),
  plate:     text("plate").notNull().unique(),       // Patente
  code:      text("code"),                            // Código interno de equipo (ej. KA-63)
  type:      text("type").notNull(),                  // camion | camioneta | estanque | ... (texto libre, ver validation.ts)
  brand:     text("brand"),                           // Marca
  model:     text("model"),                           // Modelo
  year:      integer("year"),                         // Año
  worksiteId: text("worksite_id").notNull().references(() => worksites.id),  // Faena asignada
  responsibleUserId: text("responsible_user_id").references(() => users.id),
  operationalStatus: text("operational_status").notNull().default("operativo"),
  soapExpiresAt: text("soap_expires_at"),
  technicalReviewExpiresAt: text("technical_review_expires_at"),
  circulationPermitExpiresAt: text("circulation_permit_expires_at"),
  insurancePolicyNumber: text("insurance_policy_number"),
  insuranceExpiresAt: text("insurance_expires_at"),
  isActive:  boolean("is_active").notNull().default(true),
  notes:     text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("fuel_vehicles_worksite_idx").on(table.worksiteId),
  index("fuel_vehicles_responsible_idx").on(table.responsibleUserId),
  index("fuel_vehicles_status_idx").on(table.operationalStatus),
  index("fuel_vehicles_type_idx").on(table.type),
  index("fuel_vehicles_code_idx").on(table.code),
])

export const fleetVehicleDocuments = pgTable("fleet_vehicle_documents", {
  id:           text("id").primaryKey(),
  vehicleId:    text("vehicle_id").notNull().references(() => fuelVehicles.id, { onDelete: "cascade" }),
  documentType: text("document_type").notNull(),
  fileName:     text("file_name").notNull(),
  filePath:     text("file_path").notNull(),
  fileSize:     integer("file_size"),
  mimeType:     text("mime_type"),
  expiresAt:    text("expires_at"),
  uploadedBy:   text("uploaded_by").notNull().references(() => users.id),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("fleet_vehicle_documents_vehicle_idx").on(table.vehicleId),
  index("fleet_vehicle_documents_expires_idx").on(table.expiresAt),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const fuelVehiclesRelations = relations(fuelVehicles, ({ one, many }) => ({
  worksite: one(worksites, {
    fields: [fuelVehicles.worksiteId],
    references: [worksites.id],
  }),
  responsibleUser: one(users, {
    fields: [fuelVehicles.responsibleUserId],
    references: [users.id],
  }),
  loads: many(fuelLoads),
  documents: many(fleetVehicleDocuments),
}))

export const fleetVehicleDocumentsRelations = relations(fleetVehicleDocuments, ({ one }) => ({
  vehicle: one(fuelVehicles, {
    fields: [fleetVehicleDocuments.vehicleId],
    references: [fuelVehicles.id],
  }),
  uploader: one(users, {
    fields: [fleetVehicleDocuments.uploadedBy],
    references: [users.id],
  }),
}))
