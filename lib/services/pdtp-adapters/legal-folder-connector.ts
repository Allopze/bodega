/**
 * Conector: carpeta de requisitos legales (N°19) ← Documentación SST.
 *
 * La N°19 dice "mantener actualizada la carpeta de requisitos legales". El
 * hecho que la acredita no es una carga puntual sino un estado: en el mes, la
 * faena tuvo vigentes **todos** los documentos que la actividad declara
 * (`pdtp_activity_document_requirements`). Por eso se evalúa en dos momentos:
 *
 * - cuando cambia un documento de uno de esos tipos (queda vigente al cargarlo
 *   o al publicarse, se clasifica, cambia de faena o de vencimiento); y
 * - en el barrido semanal, para que un mes sin cargas pero con la carpeta al
 *   día también quede acreditado.
 *
 * Sólo se acredita el mes en curso y sólo si tiene una celda planificada: el
 * estado de hoy no prueba cómo estaba la carpeta en un mes pasado. Una vez
 * acreditado no se revoca si un documento vence después — la carpeta estuvo
 * completa, y eso sigue siendo cierto (mismo criterio del plan de cumplimiento
 * externo, §3.1). La ejecución queda `submitted`, como la N°43: la aprueba una
 * persona, que es además la red contra un documento mal clasificado.
 *
 * Hasta el 2026-09-24 la N°19 se acreditaba con el acta de trabajador nuevo
 * (la carpeta del trabajador). Esa lectura se retiró por decisión de
 * Prevención: la carpeta es la documental de la faena.
 */
import { and, eq, inArray, isNull, or } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpActivities,
  pdtpActivityDocumentRequirements,
  pdtpExecutions,
  pdtpFulfillmentEvents,
  pdtpPrograms,
  sstDocuments,
  sstDocumentVersions,
} from "@/db/schema"
import { logger } from "@/lib/logger"
import {
  assessLegalFolder,
  describeLegalFolderEvidence,
  type LegalFolderAssessment,
  type LegalFolderCandidate,
} from "@/lib/prevention/legal-folder"
import { recordPdtpFulfillmentEvent } from "@/lib/services/pdtp/fulfillment"
import { loadProgramScheduleAndExecutions } from "@/lib/services/pdtp/helpers"
import { isPdtpActivityEffectiveForPeriod } from "@/lib/services/pdtp/retirement"
import { listPdtpActivityDocumentRequirements } from "@/lib/services/pdtp/document-requirements"
import { listPdtpProgramOperatingWorksiteIds } from "@/lib/services/pdtp/worksites"
import { chileDateParts, todayInChile } from "@/lib/utils"

export const LEGAL_FOLDER_SOURCE_TYPE = "carpeta_legal" as const

/** Destino de la carpeta en Documentación para una faena. */
export function legalFolderHref(worksiteId: string): string {
  return `/prevencion/documentacion?faena=${encodeURIComponent(worksiteId)}&carpeta=requisitos-legales`
}

const IN_PROGRESS_VERSION_STATUSES = ["borrador", "en_revision", "observado", "aprobado"] as const

type FolderActivity = {
  id: string
  n: number
  catalogActivityId: string | null
  status: string
  retiredEffectiveFrom: string | null
}

/**
 * Estado de la carpeta de una actividad en una faena, hoy. Lo usan el
 * conector y la vista de Documentación: la misma regla para lo que se muestra
 * y lo que se acredita.
 */
export async function evaluatePdtpLegalFolder(input: {
  activityId: string
  worksiteId: string
  today?: string
}): Promise<LegalFolderAssessment> {
  const today = input.today ?? todayInChile()
  const requirements = await listPdtpActivityDocumentRequirements([input.activityId])
  const typeIds = [...new Set(requirements.flatMap((requirement) => [
    requirement.documentTypeId,
    ...(requirement.mustFollowDocumentTypeId ? [requirement.mustFollowDocumentTypeId] : []),
  ]))]
  const candidates = typeIds.length === 0 ? [] : await loadLegalFolderCandidates(typeIds, input.worksiteId)
  return assessLegalFolder({
    requirements: requirements.map((requirement) => ({
      documentTypeId: requirement.documentTypeId,
      documentTypeName: requirement.documentTypeName,
      scope: requirement.scope,
      mustFollowDocumentTypeId: requirement.mustFollowDocumentTypeId,
    })),
    candidates,
    worksiteId: input.worksiteId,
    today,
  })
}

async function loadLegalFolderCandidates(typeIds: string[], worksiteId: string): Promise<LegalFolderCandidate[]> {
  const docs = await db.select({
    id: sstDocuments.id,
    title: sstDocuments.title,
    typeId: sstDocuments.typeId,
    worksiteId: sstDocuments.worksiteId,
    status: sstDocuments.status,
    expiresAt: sstDocuments.expiresAt,
    currentVersionId: sstDocuments.currentVersionId,
  }).from(sstDocuments).where(and(
    inArray(sstDocuments.typeId, typeIds),
    or(eq(sstDocuments.worksiteId, worksiteId), isNull(sstDocuments.worksiteId)),
  ))
  if (docs.length === 0) return []
  const versions = await db.select({
    id: sstDocumentVersions.id,
    documentId: sstDocumentVersions.documentId,
    version: sstDocumentVersions.version,
    status: sstDocumentVersions.status,
    effectiveFrom: sstDocumentVersions.effectiveFrom,
    updatedAt: sstDocumentVersions.updatedAt,
    checksum: sstDocumentVersions.checksum,
  }).from(sstDocumentVersions).where(inArray(sstDocumentVersions.documentId, docs.map((doc) => doc.id)))
  const versionById = new Map(versions.map((version) => [version.id, version]))
  const inProgress = new Set(versions
    .filter((version) => (IN_PROGRESS_VERSION_STATUSES as readonly string[]).includes(version.status))
    .map((version) => version.documentId))
  return docs.flatMap((doc) => {
    if (!doc.typeId) return []
    const current = doc.currentVersionId ? versionById.get(doc.currentVersionId) : undefined
    return [{
      documentId: doc.id,
      title: doc.title,
      typeId: doc.typeId,
      worksiteId: doc.worksiteId,
      status: doc.status,
      expiresAt: doc.expiresAt,
      currentVersion: current ? {
        id: current.id,
        version: current.version,
        status: current.status,
        // Sin vigencia declarada, rige desde el día en que quedó vigente: una
        // versión vigente no se vuelve a escribir hasta que la reemplazan.
        effectiveDate: current.effectiveFrom ?? todayInChile(current.updatedAt),
        checksum: current.checksum,
      } : null,
      hasVersionInProgress: inProgress.has(doc.id),
    }]
  })
}

export type LegalFolderAccreditationOutcome =
  | "accredited"
  | "already_accredited"
  | "incomplete"
  | "not_planned"
  | "not_effective"
  | "out_of_period"
  | "error"

/**
 * Acredita el mes en curso de la carpeta de `activity` en `worksiteId` si está
 * completa. Idempotente: el `sourceId` lleva faena y mes, así que un mismo mes
 * se acredita una sola vez aunque se evalúe cada semana.
 */
export async function accreditPdtpLegalFolderIfComplete(input: {
  program: { id: string; year: number }
  activity: FolderActivity
  worksiteId: string
  now?: Date
}): Promise<LegalFolderAccreditationOutcome> {
  const now = input.now ?? new Date()
  const { year, month } = chileDateParts(now)
  if (year !== input.program.year) return "out_of_period"

  // La costura única del cronograma: aplica ajustes por faena, exclusiones,
  // desvíos y retiros. Una faena excluida o un mes sin celda no tiene nada que
  // acreditar.
  const { scheduleRows } = await loadProgramScheduleAndExecutions([input.activity.id], year, input.worksiteId)
  const plannedWeeks = scheduleRows
    .filter((row) => row.month === month && row.plannedQuantity > 0)
    .map((row) => row.week)
    .sort((a, b) => a - b)
  const week = plannedWeeks[0]
  if (week === undefined) return "not_planned"
  if (!isPdtpActivityEffectiveForPeriod(input.activity, year, month, week)) return "not_effective"

  const period = `${year}-${String(month).padStart(2, "0")}`
  const sourceId = `carpeta:${input.activity.catalogActivityId ?? input.activity.id}:${input.worksiteId}:${period}`
  const [already] = await db.select({ id: pdtpFulfillmentEvents.id }).from(pdtpFulfillmentEvents)
    .where(and(
      eq(pdtpFulfillmentEvents.sourceType, LEGAL_FOLDER_SOURCE_TYPE),
      eq(pdtpFulfillmentEvents.sourceId, sourceId),
      eq(pdtpFulfillmentEvents.eventType, "completed"),
      eq(pdtpFulfillmentEvents.status, "accredited"),
    )).limit(1)
  if (already) return "already_accredited"

  const today = todayInChile(now)
  const assessment = await evaluatePdtpLegalFolder({ activityId: input.activity.id, worksiteId: input.worksiteId, today })
  if (!assessment.complete) return "incomplete"

  const result = await recordPdtpFulfillmentEvent({
    sourceType: LEGAL_FOLDER_SOURCE_TYPE,
    sourceId,
    worksiteId: input.worksiteId,
    ...(input.activity.catalogActivityId
      ? { catalogActivityIds: [input.activity.catalogActivityId] }
      : { activityNumbers: [input.activity.n] }),
    occurredAt: now.toISOString(),
    plannedPeriod: { year, month, week },
    executedQuantity: 1,
    evidenceRef: describeLegalFolderEvidence(assessment, today),
    metadata: {
      folder: {
        asOf: today,
        items: assessment.items.map((item) => ({
          documentTypeId: item.requirement.documentTypeId,
          scope: item.requirement.scope,
          documentId: item.document?.documentId ?? null,
          versionId: item.document?.versionId ?? null,
          checksum: item.document?.checksum ?? null,
          expiresAt: item.document?.expiresAt ?? null,
        })),
      },
    },
    returnHref: legalFolderHref(input.worksiteId),
  })
  return result && result.accredited.length > 0 ? "accredited" : "error"
}

/** Actividades de carpeta (con requisitos) de los programas activos del año. */
async function loadActiveFolderActivities(filter: { programId?: string; typeIds?: string[]; now?: Date }) {
  const { year } = chileDateParts(filter.now ?? new Date())
  const programs = await db.select({ id: pdtpPrograms.id, year: pdtpPrograms.year }).from(pdtpPrograms)
    .where(and(
      eq(pdtpPrograms.status, "active"),
      eq(pdtpPrograms.year, year),
      filter.programId ? eq(pdtpPrograms.id, filter.programId) : undefined,
    ))
  if (programs.length === 0) return []
  const rows = await db.selectDistinct({
    programId: pdtpActivities.programId,
    id: pdtpActivities.id,
    n: pdtpActivities.n,
    catalogActivityId: pdtpActivities.catalogActivityId,
    status: pdtpActivities.status,
    retiredEffectiveFrom: pdtpActivities.retiredEffectiveFrom,
  })
    .from(pdtpActivities)
    .innerJoin(pdtpActivityDocumentRequirements, eq(pdtpActivityDocumentRequirements.activityId, pdtpActivities.id))
    .where(and(
      inArray(pdtpActivities.programId, programs.map((program) => program.id)),
      filter.typeIds?.length
        ? or(
            inArray(pdtpActivityDocumentRequirements.documentTypeId, filter.typeIds),
            inArray(pdtpActivityDocumentRequirements.mustFollowDocumentTypeId, filter.typeIds),
          )
        : undefined,
    ))
  const programById = new Map(programs.map((program) => [program.id, program]))
  return rows.flatMap((row) => {
    const program = programById.get(row.programId)
    return program ? [{ program, activity: row }] : []
  })
}

/**
 * Un documento de la carpeta cambió (quedó vigente, se clasificó, cambió de
 * faena o de vencimiento). `worksiteIds` con un `null` significa que uno de los
 * documentos es corporativo, y entonces se reevalúan todas las faenas del
 * programa. Sin programa activo no hace nada: la carpeta se evalúa contra un
 * compromiso vigente, y un borrador todavía no lo es. Nunca lanza.
 */
export async function onLegalFolderDocumentChanged(input: {
  typeIds: Array<string | null>
  worksiteIds: Array<string | null>
  now?: Date
}): Promise<void> {
  try {
    const typeIds = [...new Set(input.typeIds.filter((id): id is string => Boolean(id)))]
    if (typeIds.length === 0) return
    const targets = await loadActiveFolderActivities({ typeIds, now: input.now })
    if (targets.length === 0) return
    const corporate = input.worksiteIds.some((id) => id === null)
    const explicit = new Set(input.worksiteIds.filter((id): id is string => Boolean(id)))
    for (const { program, activity } of targets) {
      const operating = await listPdtpProgramOperatingWorksiteIds(program.id)
      const worksiteIds = corporate ? operating : operating.filter((id) => explicit.has(id))
      for (const worksiteId of worksiteIds) {
        await accreditPdtpLegalFolderIfComplete({ program, activity, worksiteId, now: input.now })
      }
    }
  } catch (error) {
    logger.error("[legal-folder] no se pudo reevaluar la carpeta de requisitos legales", {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Barrido del mes en curso: todas las carpetas de los programas activos, en
 * todas sus faenas. Lo corre el cron semanal y la activación del programa.
 */
export async function sweepPdtpLegalFolders(options: { programId?: string; now?: Date } = {}) {
  const counts: Record<LegalFolderAccreditationOutcome, number> = {
    accredited: 0,
    already_accredited: 0,
    incomplete: 0,
    not_planned: 0,
    not_effective: 0,
    out_of_period: 0,
    error: 0,
  }
  const targets = await loadActiveFolderActivities({ programId: options.programId, now: options.now })
  for (const { program, activity } of targets) {
    const worksiteIds = await listPdtpProgramOperatingWorksiteIds(program.id)
    for (const worksiteId of worksiteIds) {
      try {
        counts[await accreditPdtpLegalFolderIfComplete({ program, activity, worksiteId, now: options.now })] += 1
      } catch (error) {
        counts.error += 1
        logger.error("[legal-folder] barrido: error en una faena", {
          activityId: activity.id,
          worksiteId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
  return counts
}

export type PdtpLegalFolderOverview = {
  programId: string
  activity: { id: string; n: number; activity: string }
  assessment: LegalFolderAssessment
  month: {
    year: number
    month: number
    /** El mes tiene una celda planificada en esta faena (si no, no hay nada que acreditar). */
    planned: boolean
    /** Estado de la ejecución del mes, si ya se acreditó: `submitted`, `approved`, `rejected`… */
    executionStatus: string | null
  }
}

/**
 * Lo que muestra Documentación sobre la carpeta de una faena: el estado de cada
 * documento exigido y si el mes en curso ya quedó acreditado. Sin programa
 * activo con carpeta declarada devuelve `null`.
 */
export async function getPdtpLegalFolderOverview(worksiteId: string, now = new Date()): Promise<PdtpLegalFolderOverview | null> {
  const [target] = await loadActiveFolderActivities({ now })
  if (!target) return null
  const { year, month } = chileDateParts(now)
  const [activityRow] = await db.select({ activity: pdtpActivities.activity })
    .from(pdtpActivities).where(eq(pdtpActivities.id, target.activity.id)).limit(1)
  const [assessment, schedule] = await Promise.all([
    evaluatePdtpLegalFolder({ activityId: target.activity.id, worksiteId, today: todayInChile(now) }),
    loadProgramScheduleAndExecutions([target.activity.id], year, worksiteId),
  ])
  const planned = schedule.scheduleRows.some((row) => row.month === month && row.plannedQuantity > 0)
  const sourceId = `carpeta:${target.activity.catalogActivityId ?? target.activity.id}:${worksiteId}:${year}-${String(month).padStart(2, "0")}`
  const [execution] = await db.select({ status: pdtpExecutions.status }).from(pdtpExecutions)
    .where(and(
      eq(pdtpExecutions.activityId, target.activity.id),
      eq(pdtpExecutions.worksiteId, worksiteId),
      eq(pdtpExecutions.sourceType, LEGAL_FOLDER_SOURCE_TYPE),
      eq(pdtpExecutions.sourceId, sourceId),
    )).limit(1)
  return {
    programId: target.program.id,
    activity: { id: target.activity.id, n: target.activity.n, activity: activityRow?.activity ?? "" },
    assessment,
    month: { year, month, planned, executionStatus: execution?.status ?? null },
  }
}
