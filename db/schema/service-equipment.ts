import { relations, sql } from "drizzle-orm"
import { pgTable, text, boolean, timestamp, check, index, uniqueIndex } from "drizzle-orm/pg-core"
import { worksites } from "./worksites"

/* ── Equipos de servicio (instrumentos) ──────────────────────────────────── */
/**
 * Registro de los instrumentos que se mandan a mantener o calibrar: detectores
 * monogás, alcotest y lo que venga.
 *
 * Existe porque no había dónde ponerlos. `fuel_vehicles` es el catálogo del
 * módulo de combustibles y exige patente única, tipo de equipo de consumo,
 * medidor y capacidad de estanque: un detector de mano no es eso. Sin este
 * registro, cada solicitud reescribía a mano el código y el número de serie del
 * mismo aparato, y no había forma de ver su historial.
 *
 * `kind` es un slug libre ('monogas', 'alcotest', …) y no un enum: sumar una
 * familia de equipos es un dato nuevo, no una migración. `products.equipment_kind`
 * apunta a este mismo slug para saber qué equipos ofrecer en cada servicio.
 */
export const serviceEquipment = pgTable("service_equipment", {
  id:           text("id").primaryKey(),
  /** Código interno con que la faena lo identifica (ej. "MG-014"). */
  code:         text("code").notNull(),
  name:         text("name").notNull(),
  kind:         text("kind").notNull(),
  brand:        text("brand"),
  model:        text("model"),
  serialNumber: text("serial_number"),
  worksiteId:   text("worksite_id").notNull().references(() => worksites.id),
  isActive:     boolean("is_active").notNull().default(true),
  notes:        text("notes"),
  createdAt:    timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  // El código interno identifica al equipo: repetirlo haría inútil el registro.
  uniqueIndex("service_equipment_code_unique").on(table.code),
  // `kind` viaja normalizado (minúsculas, sin espacios) para que el match contra
  // `products.equipment_kind` no dependa de cómo lo escribió quien lo cargó.
  check("service_equipment_kind_normalized", sql`
    ${table.kind} = lower(${table.kind})
    AND char_length(${table.kind}) BETWEEN 2 AND 40
    AND ${table.kind} !~ '\\s'
  `),
  index("service_equipment_worksite_kind_idx").on(table.worksiteId, table.kind, table.isActive),
])

export const serviceEquipmentRelations = relations(serviceEquipment, ({ one }) => ({
  worksite: one(worksites, { fields: [serviceEquipment.worksiteId], references: [worksites.id] }),
}))
