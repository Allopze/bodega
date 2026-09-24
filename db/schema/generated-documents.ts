import { pgTable, text, integer, boolean, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

/* ── Documentos generados archivados en Cloudreve ──────────────────────────
 * Decisión del 2026-09-24: cada documento formal de Prevención queda en
 * Cloudreve en el momento del hecho que lo produce (una entrega registrada, una
 * inspección revisada, un mes del PDTP cerrado…), no cuando alguien lo descarga.
 *
 * La tabla es a la vez la cola y el libro: el servicio del hecho inserta la fila
 * en su propia transacción (así un hecho confirmado nunca se queda sin su
 * copia pendiente), el procesador la toma con una concesión, arma el archivo,
 * lo deja en disco local y lo sube. Un documento que cambia después —una
 * entrega anulada, un mes cerrado otra vez— es una fila nueva con su propio
 * hito o revisión: una copia en Cloudreve nunca se sobrescribe.
 *
 * `worksite_id` va sin FK a propósito: la fila es un registro histórico y no
 * debe impedir nada sobre la faena, igual que `worksite_label` guarda el
 * nombre que tenía al momento del hecho.
 */
export const GENERATED_DOCUMENT_STATUSES = ["pending", "staged", "uploaded", "failed", "superseded"] as const
export type GeneratedDocumentStatus = (typeof GENERATED_DOCUMENT_STATUSES)[number]

export const GENERATED_DOCUMENT_RENDER_MODES = ["session", "inprocess"] as const
export type GeneratedDocumentRenderMode = (typeof GENERATED_DOCUMENT_RENDER_MODES)[number]

export const generatedDocumentArchives = pgTable("generated_document_archives", {
  id:             text("id").primaryKey(),
  kind:           text("kind").notNull(),
  entityId:       text("entity_id").notNull(),
  milestone:      text("milestone").notNull(),
  revision:       integer("revision").notNull().default(1),
  /** `kind:entity:milestone:revision`: el mismo hecho encolado dos veces es una sola fila. */
  dedupeKey:      text("dedupe_key").notNull(),
  worksiteId:     text("worksite_id"),
  worksiteLabel:  text("worksite_label"),
  /** Año del documento en hora de Chile, para el orden año › faena › módulo. */
  documentYear:   integer("document_year").notNull(),
  occurredAt:     timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
  actorUserId:    text("actor_user_id"),
  /**
   * `session`: un PDF que se imprime con la sesión de quien produjo el hecho
   * (o del administrador que lo reintenta). `inprocess`: un libro Excel que el
   * servidor arma sin sesión, así que el cron también puede reintentarlo.
   */
  renderMode:     text("render_mode").notNull(),
  status:         text("status").notNull().default("pending"),
  leaseUntil:     timestamp("lease_until", { withTimezone: true, mode: "string" }),
  attempts:       integer("attempts").notNull().default(0),
  nextAttemptAt:  timestamp("next_attempt_at", { withTimezone: true, mode: "string" }),
  /** Solo un código estable (p. ej. `RENDER_UNAUTHORIZED`), nunca un mensaje con datos. */
  lastErrorCode:  text("last_error_code"),
  /** Se generó con el estado actual, no con el del momento del hecho. */
  lateRender:     boolean("late_render").notNull().default(false),
  fileName:       text("file_name"),
  /** Se fija en el primer intento de subida; cambiar el orden de carpetas no mueve lo ya subido. */
  remoteKey:      text("remote_key"),
  sha256:         text("sha256"),
  sizeBytes:      integer("size_bytes"),
  stagedAt:       timestamp("staged_at", { withTimezone: true, mode: "string" }),
  uploadedAt:     timestamp("uploaded_at", { withTimezone: true, mode: "string" }),
  retriedByUserId: text("retried_by_user_id"),
  createdAt:      timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("gen_doc_archives_dedupe_key_uq").on(table.dedupeKey),
  // Los clientes de sincronización de Cloudreve no distinguen mayúsculas: dos
  // claves que solo difieren en eso pisarían el mismo archivo en el escritorio.
  uniqueIndex("gen_doc_archives_remote_key_uq").on(sql`lower(${table.remoteKey})`),
  index("gen_doc_archives_status_next_idx").on(table.status, table.nextAttemptAt),
  index("gen_doc_archives_entity_idx").on(table.kind, table.entityId),
  check("gen_doc_archives_status_valid", sql`${table.status} IN ('pending', 'staged', 'uploaded', 'failed', 'superseded')`),
  check("gen_doc_archives_render_mode_valid", sql`${table.renderMode} IN ('session', 'inprocess')`),
  check("gen_doc_archives_revision_positive", sql`${table.revision} >= 1`),
])

export type GeneratedDocumentArchive = typeof generatedDocumentArchives.$inferSelect
