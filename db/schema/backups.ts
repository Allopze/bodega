import { pgTable, text, timestamp, bigint, index, boolean } from "drizzle-orm/pg-core"

/**
 * Registro de cada backup ejecutado por el orquestador.
 * Permite al panel admin mostrar historial, estado y métricas.
 */
export const backupLog = pgTable("backup_log", {
  id:                text("id").primaryKey(),
  status:            text("status").notNull().$type<"running" | "success" | "failed">().default("running"),

  // Fechas
  startedAt:         timestamp("started_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  completedAt:       timestamp("completed_at", { withTimezone: true, mode: "string" }),
  backupDate:        text("backup_date").notNull(),  // YYYY-MM-DD

  // Componentes del backup
  pgSizeBytes:       bigint("pg_size_bytes", { mode: "number" }),
  pgSha256:          text("pg_sha256"),
  storageSizeBytes:  bigint("storage_size_bytes", { mode: "number" }),
  storageSha256:     text("storage_sha256"),
  configSizeBytes:   bigint("config_size_bytes", { mode: "number" }),
  configSha256:      text("config_sha256"),

  // Manifiesto
  manifestSha256:    text("manifest_sha256"),

  // Drive
  drivePath:         text("drive_path"),          // gdrive-backups:bodega-backups/YYYY-MM-DD
  driveUploaded:     boolean("drive_uploaded").default(false),

  // Cloudreve (WebDAV)
  cloudrevePath:     text("cloudreve_path"),      // backups/plataforma/YYYY-MM-DD
  cloudreveUploaded: boolean("cloudreve_uploaded").default(false),

  // Metadata
  appVersion:        text("app_version"),
  hostname:          text("hostname"),
  totalSizeBytes:    bigint("total_size_bytes", { mode: "number" }),

  // Error
  errorMessage:      text("error_message"),
  errorCode:         text("error_code"),

  // Trigger info
  trigger:           text("trigger").$type<"cron" | "manual" | "deploy">().default("cron"),
  triggeredByUserId: text("triggered_by_user_id"),
}, (table) => [
  index("backup_log_date_idx").on(table.backupDate),
  index("backup_log_status_idx").on(table.status),
  index("backup_log_started_idx").on(table.startedAt),
])
