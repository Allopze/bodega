/**
 * db/schema/contract-assignments.ts
 *
 * Asignación de un equipo de flota a un contrato, con vigencia por días.
 *
 * Una faena (un lugar) tiene varios contratos con el mandante para servicios
 * distintos; cada equipo trabaja para uno solo a la vez. La historia vive acá
 * para que el costo de un mes no cambie cuando el equipo se reasigna después
 * (diseño: docs/superpowers/specs/2026-11-18-contratos-por-faena-design.md).
 *
 * Vigencia: `valid_from` y `valid_to` son días civiles de Chile (`YYYY-MM-DD`)
 * y AMBOS son inclusivos; `valid_to` nulo = vigente. Misma convención que
 * `fuel_provider_mappings`: al reemplazar una asignación, la anterior cierra
 * el día previo al nuevo `valid_from`.
 *
 * Invariantes que la base no puede expresar sola y sostiene el servicio
 * (`lib/services/contracts/assignments.ts`, bajo bloqueo de la fila del equipo):
 * sin traslapes por equipo, y la faena del contrato = la faena del equipo al
 * asignar. Acá sólo se garantiza una asignación abierta por equipo.
 *
 * Sin `many` desde `contracts`: `clients.ts` no importa este archivo para no
 * formar un ciclo de módulos; las consultas usan joins explícitos.
 */

import { relations, sql } from "drizzle-orm"
import { pgTable, text, timestamp, check, index, uniqueIndex } from "drizzle-orm/pg-core"
import { contracts } from "./clients"
import { fuelVehicles } from "./fuel-vehicles"
import { users } from "./users"

export const contractVehicleAssignments = pgTable("contract_vehicle_assignments", {
  id:              text("id").primaryKey(),
  contractId:      text("contract_id").notNull().references(() => contracts.id, { onDelete: "restrict" }),
  vehicleId:       text("vehicle_id").notNull().references(() => fuelVehicles.id, { onDelete: "restrict" }),
  /** Primer día de la asignación (inclusivo). */
  validFrom:       text("valid_from").notNull(),
  /** Último día de la asignación (inclusivo). Null = vigente. */
  validTo:         text("valid_to"),
  reason:          text("reason"),
  createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt:       timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("contract_vehicle_assignments_open_unique").on(table.vehicleId).where(sql`${table.validTo} IS NULL`),
  index("contract_vehicle_assignments_vehicle_from_idx").on(table.vehicleId, table.validFrom),
  index("contract_vehicle_assignments_contract_from_idx").on(table.contractId, table.validFrom),
  check("contract_vehicle_assignments_dates_valid", sql`${table.validTo} IS NULL OR ${table.validTo} >= ${table.validFrom}`),
  check("contract_vehicle_assignments_from_format", sql`${table.validFrom} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`),
  check("contract_vehicle_assignments_to_format", sql`${table.validTo} IS NULL OR ${table.validTo} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`),
  check("contract_vehicle_assignments_reason_length", sql`${table.reason} IS NULL OR length(${table.reason}) <= 300`),
])

export const contractVehicleAssignmentsRelations = relations(contractVehicleAssignments, ({ one }) => ({
  contract: one(contracts, { fields: [contractVehicleAssignments.contractId], references: [contracts.id] }),
  vehicle:  one(fuelVehicles, { fields: [contractVehicleAssignments.vehicleId], references: [fuelVehicles.id] }),
}))
