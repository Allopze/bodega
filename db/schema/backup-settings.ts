import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core"

/**
 * Configuración de backups editable desde el panel admin.
 * Una sola fila con los defaults; el servicio hace upsert por id="default".
 */
export const backupSettings = pgTable("backup_settings", {
  id: text("id").primaryKey().default("default"),

  /** Hora UTC del backup diario (0-23) */
  backupHour: integer("backup_hour").notNull().default(3),

  /** Días de retención de backups locales + remotos */
  retentionDays: integer("retention_days").notNull().default(30),

  /** Horas máximas sin backup antes de alerta crítica */
  maxAgeHours: integer("max_age_hours").notNull().default(36),

  /** Timeout en minutos para el backup manual desde el panel */
  manualTimeoutMinutes: integer("manual_timeout_minutes").notNull().default(30),

  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
})
