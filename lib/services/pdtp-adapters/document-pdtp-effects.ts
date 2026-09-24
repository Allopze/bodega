/**
 * Qué efecto tendrá sobre el programa preventivo cargar un documento de un
 * tipo en una faena. Lo usa el diálogo de subida para decirlo **antes** de
 * cargar ("declarar qué archivo se va a subir"): si queda vigente de inmediato
 * o pasa por aprobación, si completa la carpeta de requisitos legales (N°19) y
 * si abre la entrega del RIOHS a la dotación (N°18).
 *
 * Es una lectura: no escribe nada. Las mismas reglas que aplican los
 * conectores (`legal-folder-connector.ts`, `riohs-rollout-connector.ts`), para
 * que lo que se anuncia sea lo que después pasa.
 */
import { and, eq, inArray, or } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpActivities,
  pdtpActivityDocumentRequirements,
  pdtpPrograms,
  sstDocumentTypes,
  worksites,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { RIOHS_DOCUMENT_TYPE_CODE } from "@/lib/prevention/riohs"
import { listPdtpProgramOperatingWorksiteIds } from "@/lib/services/pdtp/worksites"
import { chileDateParts } from "@/lib/utils"
import { evaluatePdtpLegalFolder } from "./legal-folder-connector"

export type DocumentUploadEffects = {
  typeName: string
  /** `true`: la versión queda vigente al cargarla (registro externo, sin aprobación). */
  becomesCurrentOnUpload: boolean
  /** Carpeta N°19 en las faenas que afecta esta carga. Vacío si el tipo no es de la carpeta. */
  legalFolder: Array<{
    activityNumber: number
    worksiteId: string
    worksiteName: string
    satisfiedBefore: number
    satisfiedAfter: number
    total: number
    /** Requisitos que seguirán faltando después de esta carga. */
    missingAfter: string[]
  }>
  /** Documentos de la carpeta que esta carga deja anteriores al nuevo RIOHS. */
  staleDependents: string[]
  /** N°18: entrega a la dotación que abrirá la versión al quedar vigente. */
  riohsRollout: { worksiteCount: number; dueDays: number } | null
}

export async function previewDocumentUploadEffects(input: {
  typeId: string
  worksiteId: string | null
  scope: WorksiteScope
}): Promise<DocumentUploadEffects | null> {
  const [type] = await db.select({
    id: sstDocumentTypes.id,
    name: sstDocumentTypes.name,
    code: sstDocumentTypes.code,
    requiresApproval: sstDocumentTypes.requiresApproval,
    distributionDueDays: sstDocumentTypes.distributionDueDays,
  }).from(sstDocumentTypes).where(eq(sstDocumentTypes.id, input.typeId)).limit(1)
  if (!type) return null
  const isRiohs = type.code === RIOHS_DOCUMENT_TYPE_CODE

  const { year } = chileDateParts()
  const [program] = await db.select({ id: pdtpPrograms.id }).from(pdtpPrograms)
    .where(and(eq(pdtpPrograms.status, "active"), eq(pdtpPrograms.year, year))).limit(1)

  const effects: DocumentUploadEffects = {
    typeName: type.name,
    becomesCurrentOnUpload: !type.requiresApproval && !isRiohs,
    legalFolder: [],
    staleDependents: [],
    riohsRollout: null,
  }
  if (!program) return effects

  // Faenas que toca la carga: la declarada, o —si es corporativa— las del
  // programa que la persona ve.
  const operating = await listPdtpProgramOperatingWorksiteIds(program.id)
  const allowed = input.scope.mode === "some" ? new Set<string>(input.scope.ids) : null
  const visible = input.scope.mode === "none" ? [] : allowed ? operating.filter((id) => allowed.has(id)) : operating
  const affected = input.worksiteId ? visible.filter((id) => id === input.worksiteId) : visible

  if (isRiohs && type.distributionDueDays) {
    effects.riohsRollout = { worksiteCount: affected.length, dueDays: type.distributionDueDays }
  }

  const folderActivities = await db.selectDistinct({
    id: pdtpActivities.id,
    n: pdtpActivities.n,
  })
    .from(pdtpActivities)
    .innerJoin(pdtpActivityDocumentRequirements, eq(pdtpActivityDocumentRequirements.activityId, pdtpActivities.id))
    .where(and(
      eq(pdtpActivities.programId, program.id),
      eq(pdtpActivities.status, "active"),
      or(
        eq(pdtpActivityDocumentRequirements.documentTypeId, type.id),
        eq(pdtpActivityDocumentRequirements.mustFollowDocumentTypeId, type.id),
      ),
    ))
  if (folderActivities.length === 0 || affected.length === 0) return effects

  const names = new Map((await db.select({ id: worksites.id, name: worksites.name })
    .from(worksites).where(inArray(worksites.id, affected))).map((row) => [row.id, row.name]))
  const stale = new Set<string>()
  for (const activity of folderActivities) {
    for (const worksiteId of affected) {
      const assessment = await evaluatePdtpLegalFolder({ activityId: activity.id, worksiteId })
      // Después de cargar, el requisito de este tipo queda vigente (si la
      // carga lo deja vigente, o al publicarse) y los que deben seguirlo
      // quedan anteriores.
      const after = assessment.items.map((item) => {
        // Un documento corporativo no cubre un requisito "por faena".
        if (item.requirement.documentTypeId === type.id && (input.worksiteId !== null || item.requirement.scope === "corporativo")) {
          return { item, state: "vigente" as const }
        }
        if (item.requirement.mustFollowDocumentTypeId === type.id && item.state === "vigente") {
          stale.add(item.requirement.documentTypeName)
          return { item, state: "desactualizado" as const }
        }
        return { item, state: item.state }
      })
      effects.legalFolder.push({
        activityNumber: activity.n,
        worksiteId,
        worksiteName: names.get(worksiteId) ?? worksiteId,
        satisfiedBefore: assessment.satisfied,
        satisfiedAfter: after.filter((entry) => entry.state === "vigente").length,
        total: assessment.total,
        missingAfter: after.filter((entry) => entry.state !== "vigente").map((entry) => entry.item.requirement.documentTypeName),
      })
    }
  }
  effects.staleDependents = [...stale]
  return effects
}
