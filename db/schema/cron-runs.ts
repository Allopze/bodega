import { pgTable, text, integer, timestamp, index, check } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

/* ── Bitácora transversal de corridas de cron ──────────────────────────────
 * `OBS-002` (auditoría 2026-09-14). Cuatro integraciones llevaban su propia
 * bitácora (`billing_sync_runs`, `dte_sync_runs`, `fleet_gps_sync_runs`,
 * `fuel_provider_sync_runs`) y los otros diecinueve crones no dejaban rastro
 * de haber corrido. Varios de ellos son el único mecanismo que hace visible un
 * vencimiento, así que "el cron existe" y "el cron se está ejecutando" eran dos
 * cosas distintas y sólo la primera era comprobable desde la plataforma.
 *
 * Una sola fila por corrida, escrita por `withCronLock`, que es por donde pasan
 * todos. No reemplaza las bitácoras específicas —esas guardan el detalle de su
 * integración—: responde una pregunta más simple y que ninguna respondía, la de
 * si el planificador externo sigue invocando lo que dice invocar.
 */
export const cronRuns = pgTable("cron_runs", {
  id:         text("id").primaryKey(),
  /** El mismo nombre que recibe `withCronLock`, que es el de la ruta. */
  jobName:    text("job_name").notNull(),
  startedAt:  timestamp("started_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
  /**
   * `running` sólo se ve mientras la corrida está en curso o si el proceso
   * murió a mitad: una fila que lleva horas en `running` es en sí misma la
   * señal de que algo se cayó sin cerrar.
   */
  outcome:    text("outcome").notNull().default("running"),
  durationMs: integer("duration_ms"),
  /** Mensaje de error recortado, o el motivo del salto. Nunca un stack completo. */
  detail:     text("detail"),
}, (table) => [
  check("cron_runs_outcome_valid", sql`${table.outcome} IN ('running', 'success', 'skipped', 'failed')`),
  // La consulta que importa es "¿cuándo corrió por última vez este job?".
  index("cron_runs_job_started_idx").on(table.jobName, table.startedAt),
  index("cron_runs_started_idx").on(table.startedAt),
])
