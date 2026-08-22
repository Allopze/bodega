/**
 * Gestión avanzada de evidencias (sección 10).
 * Detección de archivos corruptos, reutilización entre cargas, y políticas.
 */

import { desc, eq, isNotNull, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelTaeEvidence, fuelTaeSubmissions } from "@/db/schema/fuel-tae"
import { worksites } from "@/db/schema"

export interface CorruptFileReport {
  evidenceId: string
  fileName: string | null
  submissionId: string
  reason: string
}

/** Techo defensivo — mismo criterio y mismo valor que `BATCH_SCAN_ROW_LIMIT`
 *  en anomaly-detector.ts (no hay volumen de producción con el que calibrarlo
 *  todavía; sólo debe actuar como freno de emergencia, no como paginación real). */
const DEFAULT_EVIDENCE_ROW_LIMIT = 50_000

/** Detectar evidencias potencialmente corruptas: tamaño 0, sin filePath ni externalUrl, o mimeType no imagen.
 *  `rowLimit`: freno de emergencia contra un table scan sin límite — el llamador batch
 *  hace además una consulta por resultado (N+1 acotado, no una query nueva), así que
 *  limitar aquí también acota esa segunda pasada (sección 18). */
export async function detectCorruptEvidence(rowLimit = DEFAULT_EVIDENCE_ROW_LIMIT): Promise<CorruptFileReport[]> {
  // Sin WHERE: el filtro `isNotNull(filePath)` de antes garantizaba
  // `filePath != null` para TODA fila que llegaba al loop, así que la rama
  // "sin filePath ni externalUrl" de abajo era inalcanzable por construcción
  // — la evidencia histórica sólo-externa (Google Drive, sin filePath local)
  // nunca se revisaba.
  const rows = await db.select({
    evidenceId: fuelTaeEvidence.id,
    fileName: fuelTaeEvidence.fileName,
    filePath: fuelTaeEvidence.filePath,
    fileSize: fuelTaeEvidence.fileSize,
    mimeType: fuelTaeEvidence.mimeType,
    externalUrl: fuelTaeEvidence.externalUrl,
    submissionId: fuelTaeEvidence.submissionId,
  })
    .from(fuelTaeEvidence)
    .limit(rowLimit)

  const corrupt: CorruptFileReport[] = []
  for (const row of rows) {
    // Encadenadas como if/else if: antes "sin ruta" era un `if` aparte, así
    // que una fila con fileSize=0 Y sin filePath se reportaba dos veces.
    if (!row.filePath && !row.externalUrl) {
      corrupt.push({ evidenceId: row.evidenceId, fileName: row.fileName, submissionId: row.submissionId, reason: "Sin ruta de archivo ni URL externa" })
    } else if (row.fileSize === 0) {
      corrupt.push({ evidenceId: row.evidenceId, fileName: row.fileName, submissionId: row.submissionId, reason: "Archivo vacío (0 bytes)" })
    } else if (row.mimeType && !row.mimeType.startsWith("image/")) {
      corrupt.push({ evidenceId: row.evidenceId, fileName: row.fileName, submissionId: row.submissionId, reason: `Tipo MIME no reconocido: ${row.mimeType}` })
    }
  }
  return corrupt
}

/** Grupo de evidencias reutilizadas: mismo SHA-256 aparece en cargas distintas.
 *  `rowLimit`: mismo freno de emergencia que `detectCorruptEvidence` — el
 *  llamador batch hace una consulta adicional por hash reutilizado encontrado. */
export async function getReusedEvidence(rowLimit = DEFAULT_EVIDENCE_ROW_LIMIT): Promise<Map<string, Array<{ submissionId: string; evidenceId: string; kind: string }>>> {
  const rows = await db.select({
    sha256: fuelTaeEvidence.sha256,
    submissionId: fuelTaeEvidence.submissionId,
    evidenceId: fuelTaeEvidence.id,
    kind: fuelTaeEvidence.kind,
  })
    .from(fuelTaeEvidence)
    .where(isNotNull(fuelTaeEvidence.sha256))
    .orderBy(fuelTaeEvidence.sha256)
    .limit(rowLimit)

  const byHash = new Map<string, Array<{ submissionId: string; evidenceId: string; kind: string }>>()
  for (const row of rows) {
    if (!row.sha256) continue
    const list = byHash.get(row.sha256) ?? []
    list.push({ submissionId: row.submissionId, evidenceId: row.evidenceId, kind: row.kind })
    byHash.set(row.sha256, list)
  }

  const reused = new Map<string, Array<{ submissionId: string; evidenceId: string; kind: string }>>()
  for (const [hash, items] of byHash) {
    const uniqueSubmissions = new Set(items.map((i) => i.submissionId))
    if (uniqueSubmissions.size > 1) reused.set(hash, items)
  }
  return reused
}

/** Estadísticas de almacenamiento por faena para políticas de retención. */
export async function getEvidenceStorageStats(): Promise<Array<{ worksiteName: string; totalFiles: number; totalSizeBytes: number }>> {
  const rows = await db.select({
    worksiteName: worksites.name,
    totalFiles: sql<number>`count(${fuelTaeEvidence.id})::int`,
    totalSizeBytes: sql<number>`coalesce(sum(${fuelTaeEvidence.fileSize}), 0)`,
  })
    .from(fuelTaeEvidence)
    .innerJoin(fuelTaeSubmissions, eq(fuelTaeEvidence.submissionId, fuelTaeSubmissions.id))
    .innerJoin(worksites, eq(fuelTaeSubmissions.worksiteId, worksites.id))
    .groupBy(worksites.name)
    .orderBy(desc(sql`coalesce(sum(${fuelTaeEvidence.fileSize}), 0)`))

  return rows.map((r) => ({
    worksiteName: r.worksiteName ?? "Sin faena",
    totalFiles: Number(r.totalFiles),
    totalSizeBytes: Number(r.totalSizeBytes),
  }))
}

/** Registrar acceso a evidencia (para auditoría de descargas). */
export async function logEvidenceAccess(evidenceId: string, userId: string, action: "view" | "download") {
  const { recordAudit } = await import("@/lib/audit")
  await recordAudit({
    userId, action: "update",
    entityType: "fuel_tae_evidence", entityId: evidenceId,
    oldState: {}, newState: { accessed: action }, reason: `Acceso a evidencia: ${action}`,
  })
}
