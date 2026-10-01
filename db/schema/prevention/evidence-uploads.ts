import { sql } from "drizzle-orm"
import { check, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { users } from "../users"
import { worksites } from "../worksites"

/**
 * Registro de dueño de cada archivo que sube `storePreventionEvidence`
 * (Campañas, CGRD, Higiene y CAPA). Es el equivalente de
 * `pdtp_evidence_uploads` para esos dominios.
 *
 * PRV-01 (auditoría 2026-09-28): la acreditación automática del PDTP daba por
 * "evidencia entregada" cualquier cadena que empezara con `storage/`, sin abrir
 * el archivo. Una ruta inventada aprobaba la N°81 sola. Con esta fila, "hay
 * evidencia" pasa a significar: el archivo existe, lo subió alguien de la
 * plataforma y quedó ligado a la faena del hecho que acredita.
 *
 * La faena es nullable porque la subida no la conoce: se fija la primera vez
 * que un acto de esa faena vincula el archivo (`claimPreventionEvidenceUpload`),
 * con el mismo criterio que `assertPdtpEvidenceLinkable`. Un archivo ya fijado a
 * otra faena no se puede reutilizar.
 */
export const preventionEvidenceUploads = pgTable("prevention_evidence_uploads", {
  /** Ruta relativa tal como la devuelve la subida (`storage/cgrd-evidence/...`). */
  path:              text("path").primaryKey(),
  domain:            text("domain").notNull(),
  uploadedByUserId:  text("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  worksiteId:        text("worksite_id").references(() => worksites.id, { onDelete: "restrict" }),
  sha256:            text("sha256").notNull(),
  sizeBytes:         integer("size_bytes").notNull(),
  mimeType:          text("mime_type").notNull(),
  createdAt:         timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  claimedAt:         timestamp("claimed_at", { withTimezone: true, mode: "string" }),
}, (table) => [
  index("prevention_evidence_uploads_worksite_idx").on(table.worksiteId),
  check("prevention_evidence_uploads_domain_check", sql`${table.domain} IN ('campaign', 'cgrd', 'hygiene', 'capa', 'miper')`),
  check("prevention_evidence_uploads_sha256_check", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  check("prevention_evidence_uploads_size_check", sql`${table.sizeBytes} > 0`),
  check("prevention_evidence_uploads_claim_check", sql`(${table.worksiteId} IS NULL) = (${table.claimedAt} IS NULL)`),
])

export type PreventionEvidenceUpload = typeof preventionEvidenceUploads.$inferSelect
