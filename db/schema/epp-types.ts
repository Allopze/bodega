/**
 * TAXONOMÍA CERRADA — no tiene pantalla de administración a propósito.
 *
 * `epp_types.code` es el vocabulario de zona corporal contra el que
 * `computeEppCoverageGaps` acredita cobertura, y `EPP_TYPE_TO_BODY_PART_CODE`
 * (en `lib/services/epp-import.types.ts`) traduce el nombre del producto a
 * estos códigos. Un tipo creado desde una UI no tendría entrada en ese mapa:
 * la inferencia nunca lo asignaría y quedaría como una zona corporal que sólo
 * se puede elegir a mano, dividiendo en silencio el universo de cobertura.
 *
 * Agregar un tipo es un cambio de código: fila sembrada por migración + entrada
 * en `EPP_TYPE_TO_BODY_PART_CODE` + caso en
 * `lib/services/epp-import.types.test.ts`.
 */
import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core"

/* ── EPP Types ── Canonical EPP type classification ─────────────────────── */
export const eppTypes = pgTable("epp_types", {
  id:        text("id").primaryKey(),
  code:      text("code").notNull().unique(),
  label:     text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
})
