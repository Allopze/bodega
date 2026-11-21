import { sql } from "drizzle-orm"
import { check, foreignKey, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { fuelVehicles } from "./fuel-vehicles"
import { users } from "./users"

/**
 * Períodos en que el dueño se llevó un equipo para uso personal. En esos días el
 * equipo no suma plata, litros, km, horas ni ralentí en ningún agregado de gestión
 * (la regla común está en `lib/fleet/personal-use-sql.ts`); pagos, conciliaciones,
 * registros y Mantención siguen viéndolo todo.
 *
 * `started_on` / `ended_on`: días calendario de Chile en texto `YYYY-MM-DD`, ambos
 * inclusivos; `ended_on` nulo = el equipo aún no vuelve. Sin solapes por equipo:
 * lo garantiza el trigger `PERSONAL_USE_OVERLAP` de la migración.
 */
export const fuelVehiclePersonalUsePeriods = pgTable("fuel_vehicle_personal_use_periods", {
  id: text("id").primaryKey(),
  vehicleId: text("vehicle_id").notNull(),
  startedOn: text("started_on").notNull(),
  endedOn: text("ended_on"),
  note: text("note"),
  createdByUserId: text("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  // Nombres explícitos: los que arma drizzle pasan de 63 caracteres y Postgres los truncaría.
  foreignKey({ name: "fuel_vehicle_personal_use_periods_vehicle_fk", columns: [table.vehicleId], foreignColumns: [fuelVehicles.id] }).onDelete("cascade"),
  foreignKey({ name: "fuel_vehicle_personal_use_periods_created_by_fk", columns: [table.createdByUserId], foreignColumns: [users.id] }).onDelete("set null"),
  check("fuel_vehicle_personal_use_periods_dates_valid", sql`${table.endedOn} IS NULL OR ${table.endedOn} >= ${table.startedOn}`),
  check("fuel_vehicle_personal_use_periods_started_format", sql`${table.startedOn} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`),
  check("fuel_vehicle_personal_use_periods_ended_format", sql`${table.endedOn} IS NULL OR ${table.endedOn} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`),
  uniqueIndex("fuel_vehicle_personal_use_periods_open_unique").on(table.vehicleId).where(sql`${table.endedOn} IS NULL`),
  index("fuel_vehicle_personal_use_periods_vehicle_started_idx").on(table.vehicleId, table.startedOn),
])
