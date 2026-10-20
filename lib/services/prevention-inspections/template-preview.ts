import { asc, desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { preventionInspectionTemplates } from "@/db/schema"
import { requireAccess, type InspectionAccess } from "@/lib/services/prevention-inspections-access"
import {
  INSPECTION_PROVENANCE_LABELS,
  inspectionTemplateStatusLabel,
} from "@/lib/prevention/inspections"
import {
  buildInspectionTemplatePreview,
  type TemplatePreviewPayload,
} from "@/lib/prevention/inspection-template-preview"
import type { ChecklistDefinition } from "@/lib/sst/types"

/**
 * Lo que se necesita para leer una plantilla antes de aprobarla o de declarar su
 * paridad: el cuestionario tal como lo vería quien ejecuta, el historial de
 * versiones del mismo código y el detalle técnico con que se coteja contra el
 * anexo oficial.
 *
 * Es una lectura bajo demanda (la pide la hoja al abrirse) y no parte de
 * `listInspectionTemplates`: el snapshot de cada plantilla pesa decenas de
 * kilobytes y la tabla sólo necesita el resumen. Las plantillas no cuelgan de
 * una faena, así que basta el permiso de ver; no existir devuelve `null`.
 */
export async function getInspectionTemplatePreview(
  templateId: string,
  access: InspectionAccess,
): Promise<TemplatePreviewPayload | null> {
  requireAccess(access, "prevention:inspections:view")

  const [row] = await db.select().from(preventionInspectionTemplates)
    .where(eq(preventionInspectionTemplates.id, templateId))
    .limit(1)
  if (!row) return null

  // Todas las versiones del mismo instrumento, la más nueva primero. Las
  // reemplazadas y las retiradas ya no están en la tabla del catálogo: este es
  // el único lugar donde se leen.
  const siblings = await db.select({
    id: preventionInspectionTemplates.id,
    versionLabel: preventionInspectionTemplates.versionLabel,
    status: preventionInspectionTemplates.status,
    supersededByTemplateId: preventionInspectionTemplates.supersededByTemplateId,
    createdAt: preventionInspectionTemplates.createdAt,
    approvedAt: preventionInspectionTemplates.approvedAt,
    supersededAt: preventionInspectionTemplates.supersededAt,
  }).from(preventionInspectionTemplates)
    .where(eq(preventionInspectionTemplates.code, row.code))
    .orderBy(desc(preventionInspectionTemplates.createdAt), asc(preventionInspectionTemplates.versionLabel))

  const parity = row.parityReport
  const source = row.sourceSnapshot

  return {
    template: {
      id: row.id,
      code: row.code,
      versionLabel: row.versionLabel,
      name: row.name,
      kind: row.kind,
      status: row.status,
      statusLabel: inspectionTemplateStatusLabel(row.status, row.supersededByTemplateId),
      createdAt: row.createdAt,
      approvedAt: row.approvedAt,
      supersededAt: row.supersededAt,
    },
    questionnaire: buildInspectionTemplatePreview(row.definitionSnapshot as unknown as ChecklistDefinition),
    versions: siblings.map((version) => ({
      id: version.id,
      versionLabel: version.versionLabel,
      status: version.status,
      statusLabel: inspectionTemplateStatusLabel(version.status, version.supersededByTemplateId),
      createdAt: version.createdAt,
      approvedAt: version.approvedAt,
      supersededAt: version.supersededAt,
      current: version.id === row.id,
    })),
    technical: {
      code: row.code,
      sourceDefinitionCode: row.sourceDefinitionCode,
      provenanceLabel: INSPECTION_PROVENANCE_LABELS[row.provenanceKind] ?? row.provenanceKind,
      source: source
        ? {
            documentId: source.documentId,
            versionId: source.versionId,
            fileName: source.fileName,
            revision: source.revision,
            checksumSha256: source.checksumSha256,
          }
        : null,
      contentHash: row.contentHash,
      parity: parity
        ? {
            status: parity.status,
            expectedItems: parity.expectedItems ?? null,
            actualItems: parity.actualItems ?? null,
            differences: parity.differences ?? [],
            verifiedAt: parity.verifiedAt ?? null,
          }
        : null,
    },
  }
}
