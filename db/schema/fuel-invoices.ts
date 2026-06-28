import { relations, sql } from "drizzle-orm"
import { pgTable, text, numeric, timestamp, check, index } from "drizzle-orm/pg-core"
import { users } from "./users"
import { worksites } from "./worksites"
import { fuelVehicles } from "./fuel-vehicles"
import { fuelSuppliers } from "./fuel-suppliers"

/* ── Fuel Load States ────────────────────────────────────────────────────── */
// draft | registered | reconciled | cancelled

/* ── Fuel Monthly Statement States ───────────────────────────────────────── */
// open | partial | paid | overdue | cancelled

/* ── Fuel Loads (carga individual de combustible) ────────────────────────── */
export const fuelLoads = pgTable("fuel_loads", {
  id:             text("id").primaryKey(),
  statementId:    text("statement_id"),                          // nullable, vincula a cuenta corriente
  loadDate:       text("load_date").notNull(),                   // "2026-01-15"
  month:          text("month").notNull(),                       // "2026-01" (para agrupar)
  serviceType:    text("service_type").notNull(),                // TCT | TAE
  vehicleId:      text("vehicle_id").notNull().references(() => fuelVehicles.id),
  fuelSupplierId: text("fuel_supplier_id").notNull().references(() => fuelSuppliers.id),
  worksiteId:     text("worksite_id").notNull().references(() => worksites.id),
  product:        text("product").notNull(),                     // PETROLEO DIESEL | BLUEMAX
  receiptNumber:  text("receipt_number"),                        // Nro boleta/factura
  odometerReading:  numeric("odometer_reading", { precision: 12, scale: 2, mode: "number" }),
  hourMeterReading: numeric("hour_meter_reading", { precision: 12, scale: 2, mode: "number" }),
  liters:         numeric("liters", { precision: 12, scale: 4, mode: "number" }).notNull(),
  iecFixed:       numeric("iec_fixed", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  iecVariable:    numeric("iec_variable", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  baseAmount:     numeric("base_amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
  iecTotal:       numeric("iec_total", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  ivaAmount:      numeric("iva_amount", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  totalAmount:    numeric("total_amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
  status:         text("status").notNull().default("draft"),
  notes:          text("notes"),
  createdBy:      text("created_by").notNull().references(() => users.id),
  createdAt:      timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fuel_loads_status_valid", sql`
    ${table.status} IN ('draft', 'registered', 'reconciled', 'cancelled')
  `),
  check("fuel_loads_service_type_valid", sql`
    ${table.serviceType} IN ('TCT', 'TAE')
  `),
  check("fuel_loads_liters_positive", sql`${table.liters} >= 0`),
  index("fuel_loads_month_idx").on(table.month),
  index("fuel_loads_vehicle_idx").on(table.vehicleId),
  index("fuel_loads_worksite_idx").on(table.worksiteId),
  index("fuel_loads_supplier_idx").on(table.fuelSupplierId),
  index("fuel_loads_statement_idx").on(table.statementId),
  index("fuel_loads_status_idx").on(table.status),
])

/* ── Fuel Monthly Statements (cuenta corriente mensual por proveedor) ────── */
export const fuelMonthlyStatements = pgTable("fuel_monthly_statements", {
  id:               text("id").primaryKey(),
  month:            text("month").notNull(),                     // "2026-01"
  fuelSupplierId:   text("fuel_supplier_id").notNull().references(() => fuelSuppliers.id),
  totalLiters:      numeric("total_liters", { precision: 14, scale: 4, mode: "number" }).notNull().default(0),
  totalBaseAmount:  numeric("total_base_amount", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  totalIec:         numeric("total_iec", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  totalIva:         numeric("total_iva", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  totalAmount:      numeric("total_amount", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  paidAmount:       numeric("paid_amount", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
  dueDate:          text("due_date"),                            // Fecha de pago esperada
  status:           text("status").notNull().default("open"),
  notes:            text("notes"),
  createdBy:        text("created_by").notNull().references(() => users.id),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fuel_statements_status_valid", sql`
    ${table.status} IN ('open', 'partial', 'paid', 'overdue', 'cancelled')
  `),
  index("fuel_statements_month_supplier_idx").on(table.month, table.fuelSupplierId),
  index("fuel_statements_status_idx").on(table.status),
])

/* ── Fuel Payments (pagos contra cuenta corriente mensual) ───────────────── */
export const fuelPayments = pgTable("fuel_payments", {
  id:            text("id").primaryKey(),
  statementId:   text("statement_id").notNull().references(() => fuelMonthlyStatements.id, { onDelete: "cascade" }),
  paymentDate:   text("payment_date").notNull(),
  amount:        numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
  paymentMethod: text("payment_method"),                         // transferencia | cheque | efectivo
  reference:     text("reference"),                              // Nro comprobante
  notes:         text("notes"),
  createdBy:     text("created_by").notNull().references(() => users.id),
  createdAt:     timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  check("fuel_payments_amount_positive", sql`${table.amount} > 0`),
  index("fuel_payments_statement_idx").on(table.statementId),
])

/* ── Relations ───────────────────────────────────────────────────────────── */
export const fuelLoadsRelations = relations(fuelLoads, ({ one }) => ({
  vehicle:  one(fuelVehicles, { fields: [fuelLoads.vehicleId], references: [fuelVehicles.id] }),
  supplier: one(fuelSuppliers, { fields: [fuelLoads.fuelSupplierId], references: [fuelSuppliers.id] }),
  worksite: one(worksites, { fields: [fuelLoads.worksiteId], references: [worksites.id] }),
  statement: one(fuelMonthlyStatements, { fields: [fuelLoads.statementId], references: [fuelMonthlyStatements.id] }),
  creator:  one(users, { fields: [fuelLoads.createdBy], references: [users.id] }),
}))

export const fuelMonthlyStatementsRelations = relations(fuelMonthlyStatements, ({ one, many }) => ({
  supplier: one(fuelSuppliers, { fields: [fuelMonthlyStatements.fuelSupplierId], references: [fuelSuppliers.id] }),
  loads:    many(fuelLoads),
  payments: many(fuelPayments),
  creator:  one(users, { fields: [fuelMonthlyStatements.createdBy], references: [users.id] }),
}))

export const fuelPaymentsRelations = relations(fuelPayments, ({ one }) => ({
  statement: one(fuelMonthlyStatements, { fields: [fuelPayments.statementId], references: [fuelMonthlyStatements.id] }),
  creator:   one(users, { fields: [fuelPayments.createdBy], references: [users.id] }),
}))
