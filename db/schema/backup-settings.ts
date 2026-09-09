import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core"

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

  /** Subir el snapshot a Google Drive vía rclone. Off por defecto: el destino
   *  remoto activo es Cloudreve (solo local + Cloudreve). */
  driveBackupsEnabled: boolean("drive_backups_enabled").notNull().default(false),

  /** Subir el snapshot a Cloudreve (WebDAV) usando las credenciales del
   *  almacenamiento de documentos SST. */
  cloudreveBackupsEnabled: boolean("cloudreve_backups_enabled").notNull().default(false),

  /** Carpeta remota (dentro del WebDAV) donde se guardan los snapshots. */
  cloudreveBackupsPath: text("cloudreve_backups_path").notNull().default("backups/plataforma"),

  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
})
