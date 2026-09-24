/**
 * Lo que necesita la tarjeta «Documentos generados» de Administración: el
 * estado de la cola y el reintento manual.
 */
import { and, count, desc, eq, inArray, or } from "drizzle-orm"
import { db } from "@/db"
import { generatedDocumentArchives, type GeneratedDocumentStatus } from "@/db/schema"
import type { PrintCredential } from "@/lib/pdf/render-print-page"
import { GENERATED_DOCUMENT_KIND_SPECS, isGeneratedDocumentKind } from "./kinds"
import { drainGeneratedDocuments, type DrainSummary } from "./drain"

export interface GeneratedArchiveQueueRow {
  id: string
  kind: string
  kindLabel: string
  milestone: string
  status: string
  worksiteLabel: string | null
  occurredAt: string
  fileName: string | null
  remoteKey: string | null
  lastErrorCode: string | null
  lateRender: boolean
  attempts: number
  renderMode: string
}

export interface GeneratedArchiveQueueOverview {
  counts: Record<GeneratedDocumentStatus, number>
  /** Lo que necesita atención (fallidos y pendientes), más reciente primero. */
  attention: GeneratedArchiveQueueRow[]
  /** Últimos subidos, para confirmar que el archivado funciona. */
  recentUploads: GeneratedArchiveQueueRow[]
}

function toQueueRow(row: typeof generatedDocumentArchives.$inferSelect): GeneratedArchiveQueueRow {
  return {
    id: row.id,
    kind: row.kind,
    kindLabel: isGeneratedDocumentKind(row.kind) ? GENERATED_DOCUMENT_KIND_SPECS[row.kind].label : row.kind,
    milestone: row.milestone,
    status: row.status,
    worksiteLabel: row.worksiteLabel,
    occurredAt: row.occurredAt,
    fileName: row.fileName,
    remoteKey: row.remoteKey,
    lastErrorCode: row.lastErrorCode,
    lateRender: row.lateRender,
    attempts: row.attempts,
    renderMode: row.renderMode,
  }
}

export async function getGeneratedArchiveQueueOverview(): Promise<GeneratedArchiveQueueOverview> {
  const [grouped, attention, recentUploads] = await Promise.all([
    db.select({ status: generatedDocumentArchives.status, total: count() })
      .from(generatedDocumentArchives).groupBy(generatedDocumentArchives.status),
    db.select().from(generatedDocumentArchives)
      .where(inArray(generatedDocumentArchives.status, ["failed", "pending", "staged"]))
      .orderBy(desc(generatedDocumentArchives.createdAt)).limit(50),
    db.select().from(generatedDocumentArchives)
      .where(eq(generatedDocumentArchives.status, "uploaded"))
      .orderBy(desc(generatedDocumentArchives.uploadedAt)).limit(10),
  ])
  const counts: Record<GeneratedDocumentStatus, number> = { pending: 0, staged: 0, uploaded: 0, failed: 0, superseded: 0 }
  for (const row of grouped) {
    if (row.status in counts) counts[row.status as GeneratedDocumentStatus] = Number(row.total)
  }
  return { counts, attention: attention.map(toQueueRow), recentUploads: recentUploads.map(toQueueRow) }
}

export class GeneratedArchiveRetryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GeneratedArchiveRetryError"
  }
}

export interface RetryActor {
  userId: string
  permissions: readonly string[]
  canAccessWorksite: (worksiteId: string) => boolean
}

/**
 * Reintenta una fila. Un PDF se imprime con la sesión de quien pulsa el botón,
 * así que además de `admin:storage` (lo exige la acción) hace falta poder ver
 * el documento y su faena: si no, se estaría imprimiendo con una sesión que en
 * la plataforma no podría abrirlo.
 */
export async function retryGeneratedDocument(
  id: string,
  actor: RetryActor,
  credential: PrintCredential | null,
): Promise<DrainSummary> {
  const [row] = await db.select().from(generatedDocumentArchives)
    .where(and(
      eq(generatedDocumentArchives.id, id),
      or(inArray(generatedDocumentArchives.status, ["failed", "pending", "staged"])),
    ))
    .limit(1)
  if (!row || !isGeneratedDocumentKind(row.kind)) throw new GeneratedArchiveRetryError("El documento no está pendiente de archivar.")
  const spec = GENERATED_DOCUMENT_KIND_SPECS[row.kind]
  if (!actor.permissions.includes(spec.viewPermission) || (row.worksiteId && !actor.canAccessWorksite(row.worksiteId))) {
    throw new GeneratedArchiveRetryError("No tienes acceso a este documento en la plataforma.")
  }
  if (row.renderMode === "session" && row.status !== "staged" && !credential) {
    throw new GeneratedArchiveRetryError("No se encontró tu sesión para imprimir el documento.")
  }
  return drainGeneratedDocuments({ ids: [id], credential, retriedByUserId: actor.userId, limit: 1 })
}
