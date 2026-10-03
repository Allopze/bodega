/**
 * Acceso de lectura a la evidencia de una ocurrencia del Programa de Trabajo,
 * para la ruta de descarga. La evidencia sólo se sirve si la subida es de verdad
 * la de un registro de una actividad de una faena del alcance de quien pide:
 *
 *   evidencia → registro → ocurrencia → actividad → programa (faena)
 *
 * Retirada y anulada **sí** se sirven: retirar o anular no borra nada (son de
 * sólo inserción), y quien audita el programa tiene que poder abrir lo que se
 * retiró. La ruta devuelve `withdrawnAt` / `recordVoidedAt` por si la UI quiere
 * marcarlo.
 */
import { and, eq, inArray } from "drizzle-orm"
import {
  preventionEvidenceUploads, preventionRiskOccurrenceEvidence, preventionRiskProgramActions,
  preventionRiskProgramOccurrenceRecords, preventionRiskProgramOccurrences, preventionRiskPrograms,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import type { Client } from "./shared"

export type MiperEvidenceFile = {
  storedPath: string
  mimeType: string | null
  withdrawnAt: string | null
  recordVoidedAt: string | null
}

/** `null` = no existe como evidencia de un registro, o está fuera del alcance. */
export async function findMiperEvidenceForDownload(client: Client, storedPath: string, scope: WorksiteScope): Promise<MiperEvidenceFile | null> {
  if (scope.mode === "none") return null
  const [row] = await client.select({
    storedPath: preventionRiskOccurrenceEvidence.evidenceUploadId,
    mimeType: preventionEvidenceUploads.mimeType,
    withdrawnAt: preventionRiskOccurrenceEvidence.withdrawnAt,
    recordVoidedAt: preventionRiskProgramOccurrenceRecords.voidedAt,
  }).from(preventionRiskOccurrenceEvidence)
    .innerJoin(preventionRiskProgramOccurrenceRecords, eq(preventionRiskProgramOccurrenceRecords.id, preventionRiskOccurrenceEvidence.recordId))
    .innerJoin(preventionRiskProgramOccurrences, eq(preventionRiskProgramOccurrences.id, preventionRiskProgramOccurrenceRecords.occurrenceId))
    .innerJoin(preventionRiskProgramActions, eq(preventionRiskProgramActions.id, preventionRiskProgramOccurrences.actionId))
    .innerJoin(preventionRiskPrograms, eq(preventionRiskPrograms.id, preventionRiskProgramActions.programId))
    .leftJoin(preventionEvidenceUploads, and(
      eq(preventionEvidenceUploads.path, preventionRiskOccurrenceEvidence.evidenceUploadId),
      eq(preventionEvidenceUploads.domain, "miper"),
    ))
    .where(and(
      eq(preventionRiskOccurrenceEvidence.evidenceUploadId, storedPath),
      scope.mode === "all" ? undefined : inArray(preventionRiskPrograms.worksiteId, scope.ids),
    ))
    .limit(1)
  return row ?? null
}
