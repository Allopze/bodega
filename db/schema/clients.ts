/**
 * db/schema/clients.ts
 *
 * Dominio comercial: clientes, contactos y contratos.
 *
 * Es el lado inverso de `suppliers` (proveedores). Se modela aparte a
 * propósito: un proveedor y un cliente pueden compartir RUT en la realidad,
 * pero su semántica, sus permisos y su ciclo de vida no tienen nada que ver.
 *
 * La faena (`worksites`) sigue siendo el eje de scope de permisos de toda la
 * plataforma, así que un contrato puede acotarse a una faena o ser
 * transversal (worksite_id nulo).
 */

import { relations, sql } from "drizzle-orm"
import { pgTable, text, boolean, integer, numeric, timestamp, check, index, uniqueIndex } from "drizzle-orm/pg-core"
import { users } from "./users"
import { worksites } from "./worksites"
import { costCenters } from "./cost-centers"

/* ── Clients (Clientes) ──────────────────────────────────────────────────── */

/**
 * Cliente al que Chome factura. El RUT normalizado (sin puntos, con guion)
 * es la clave de negocio: es lo que permite cruzar una factura sincronizada
 * del portal con el cliente interno.
 */
export const clients = pgTable("clients", {
  id:               text("id").primaryKey(),
  /** RUT normalizado por `lib/rut.ts::cleanRut` (ej: "76123456-7"). */
  rut:              text("rut").notNull(),
  /** Razón social. */
  name:             text("name").notNull(),
  /** Nombre de fantasía, si difiere de la razón social. */
  tradeName:        text("trade_name"),
  businessActivity: text("business_activity"),
  email:            text("email"),
  phone:            text("phone"),
  address:          text("address"),
  commune:          text("commune"),
  city:             text("city"),
  /**
   * Días de plazo de pago por defecto. Se usa para derivar el vencimiento de
   * una factura cuando el contrato no define uno propio. Null = sin default.
   */
  paymentTermsDays: integer("payment_terms_days"),
  /** Moneda habitual del cliente (ISO 4217). */
  defaultCurrency:  text("default_currency").notNull().default("CLP"),
  /** Responsable comercial / de cobranza por defecto. */
  ownerUserId:      text("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  isActive:         boolean("is_active").notNull().default(true),
  notes:            text("notes"),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("clients_rut_unique").on(table.rut),
  index("clients_name_idx").on(table.name),
  index("clients_active_idx").on(table.isActive).where(sql`${table.isActive} = true`),
  check("clients_rut_nonempty", sql`length(${table.rut}) > 0`),
  check("clients_name_nonempty", sql`length(${table.name}) > 0`),
  check("clients_payment_terms_range", sql`${table.paymentTermsDays} IS NULL OR (${table.paymentTermsDays} >= 0 AND ${table.paymentTermsDays} <= 365)`),
  check("clients_currency_format", sql`${table.defaultCurrency} ~ '^[A-Z]{3}$'`),
])

/* ── Client Contacts (Contactos del cliente) ─────────────────────────────── */

export const clientContacts = pgTable("client_contacts", {
  id:        text("id").primaryKey(),
  clientId:  text("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  name:      text("name").notNull(),
  role:      text("role"),
  email:     text("email"),
  phone:     text("phone"),
  /** Contacto al que se dirigen las gestiones de cobranza. */
  isBilling: boolean("is_billing").notNull().default(false),
  isActive:  boolean("is_active").notNull().default(true),
  notes:     text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("client_contacts_client_idx").on(table.clientId),
  check("client_contacts_name_nonempty", sql`length(${table.name}) > 0`),
])

/* ── Contracts (Contratos) ───────────────────────────────────────────────── */

/**
 * Contrato con un cliente. `worksiteId` nulo = contrato transversal a varias
 * faenas; la faena concreta de cada cobro se registra en el vínculo de la
 * factura o de la propuesta, no acá.
 */
export const contracts = pgTable("contracts", {
  id:               text("id").primaryKey(),
  /** Código interno legible, ej: "CTR-2026-0007". Único. */
  code:             text("code").notNull(),
  clientId:         text("client_id").notNull().references(() => clients.id),
  name:             text("name").notNull(),
  /** Faena principal, si el contrato es de una sola. */
  worksiteId:       text("worksite_id").references(() => worksites.id, { onDelete: "set null" }),
  costCenterId:     text("cost_center_id").references(() => costCenters.id, { onDelete: "set null" }),
  /** Orden de compra marco que el cliente entregó, si existe. */
  clientPoNumber:   text("client_po_number"),
  startDate:        text("start_date"),                    // "YYYY-MM-DD"
  endDate:          text("end_date"),                      // "YYYY-MM-DD"
  currency:         text("currency").notNull().default("CLP"),
  /** Plazo de pago del contrato; gana sobre el del cliente. */
  paymentTermsDays: integer("payment_terms_days"),
  /**
   * Periodicidad esperada del cobro. Alimenta la detección de períodos sin
   * facturar; `none` = se factura por hito, no por calendario.
   */
  billingCycle:     text("billing_cycle").notNull().$type<"monthly" | "milestone" | "none">().default("monthly"),
  /** Monto pactado del período (referencia para la propuesta). Null = variable. */
  periodAmount:     numeric("period_amount", { precision: 14, scale: 2, mode: "number" }),
  ownerUserId:      text("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  status:           text("status").notNull().$type<"active" | "suspended" | "closed">().default("active"),
  notes:            text("notes"),
  createdAt:        timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("contracts_code_unique").on(table.code),
  index("contracts_client_idx").on(table.clientId),
  index("contracts_worksite_idx").on(table.worksiteId),
  index("contracts_status_idx").on(table.status),
  check("contracts_status_valid", sql`${table.status} IN ('active', 'suspended', 'closed')`),
  check("contracts_billing_cycle_valid", sql`${table.billingCycle} IN ('monthly', 'milestone', 'none')`),
  check("contracts_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  check("contracts_payment_terms_range", sql`${table.paymentTermsDays} IS NULL OR (${table.paymentTermsDays} >= 0 AND ${table.paymentTermsDays} <= 365)`),
  check("contracts_dates_ordered", sql`${table.startDate} IS NULL OR ${table.endDate} IS NULL OR ${table.startDate} <= ${table.endDate}`),
  check("contracts_period_amount_non_negative", sql`${table.periodAmount} IS NULL OR ${table.periodAmount} >= 0`),
])

/* ── Relations ───────────────────────────────────────────────────────────── */

export const clientsRelations = relations(clients, ({ one, many }) => ({
  owner:     one(users, { fields: [clients.ownerUserId], references: [users.id] }),
  contacts:  many(clientContacts),
  contracts: many(contracts),
}))

export const clientContactsRelations = relations(clientContacts, ({ one }) => ({
  client: one(clients, { fields: [clientContacts.clientId], references: [clients.id] }),
}))

export const contractsRelations = relations(contracts, ({ one }) => ({
  client:     one(clients, { fields: [contracts.clientId], references: [clients.id] }),
  worksite:   one(worksites, { fields: [contracts.worksiteId], references: [worksites.id] }),
  costCenter: one(costCenters, { fields: [contracts.costCenterId], references: [costCenters.id] }),
  owner:      one(users, { fields: [contracts.ownerUserId], references: [users.id] }),
}))
