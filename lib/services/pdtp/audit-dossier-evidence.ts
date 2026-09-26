import { existsSync } from "node:fs"
import { resolvePdtpEvidenceFile } from "@/lib/storage/config"

/**
 * Qué respalda una ejecución en el expediente de auditor (PREV-I06,
 * auditoría 2026-09-26). Antes cualquier texto contaba como "Con evidencia:
 * Sí", incluso "Migrado sin evidencia adjunta" o un archivo ya borrado: el
 * documento que se entrega a un auditor externo afirmaba algo falso.
 *
 * - `file`: un archivo de evidencia que existe en disco.
 * - `source_record`: acreditada por integración; la respalda el registro del
 *   submódulo de origen.
 * - `missing_file`: la fila apunta a un archivo que ya no existe.
 * - `declaration`: sólo una observación escrita.
 * - `none`: nada.
 */
export type PdtpExecutionEvidenceKind = "file" | "source_record" | "missing_file" | "declaration" | "none"

export const PDTP_EVIDENCE_KIND_LABELS: Record<PdtpExecutionEvidenceKind, string> = {
  file: "Archivo verificado",
  source_record: "Registro de origen",
  missing_file: "Archivo no encontrado",
  declaration: "Solo declaración",
  none: "Sin evidencia",
}

export function classifyPdtpExecutionEvidence(execution: {
  origin: string
  sourceId: string | null
  evidenceUrl: string | null
  evidencePhotos: unknown
  evidenceText: string | null
}): PdtpExecutionEvidenceKind {
  const photos = Array.isArray(execution.evidencePhotos)
    ? execution.evidencePhotos.filter((value): value is string => typeof value === "string")
    : []
  const references = [execution.evidenceUrl, ...photos].filter((value): value is string => Boolean(value))
  const pdtpFiles = references
    .map((reference) => resolvePdtpEvidenceFile(reference))
    .filter((absolutePath): absolutePath is string => Boolean(absolutePath))
  if (pdtpFiles.some((absolutePath) => existsSync(absolutePath))) return "file"
  if (execution.origin === "integration" && execution.sourceId) return "source_record"
  if (pdtpFiles.length > 0) return "missing_file"
  if (execution.evidenceText?.trim()) return "declaration"
  return "none"
}
