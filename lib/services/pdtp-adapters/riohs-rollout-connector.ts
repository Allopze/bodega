/**
 * Conector: entrega de una versión del RIOHS a toda la dotación (N°18) ←
 * Documentación SST.
 *
 * La N°18 ("entregar el Reglamento Interno a cada trabajador") ya se acredita
 * para quien ingresa, con el acta de trabajador nuevo. Lo que no existía es el
 * otro momento en que el reglamento tiene que entregarse: cuando cambia. Una
 * versión nueva (incluida la primera que se publica en la plataforma) obliga a
 * entregarla a **toda** la dotación vigente, y ese deber no aparecía en ningún
 * lado. Decisión de Prevención del 2026-09-24:
 *
 * - al quedar vigente una versión, se abre por faena una obligación N°18,
 *   "entregar la versión vN a toda la dotación", con el plazo que declara el
 *   tipo documental (30 días, `sst_document_types.distribution_due_days`);
 * - la versión se asigna a la dotación activa de cada faena para su acuse;
 * - la obligación se reporta sola cuando cada trabajador activo de la faena
 *   acusó recibo o quedó exento con motivo. El acuse es propio: quien no tiene
 *   cuenta en la plataforma se exime (en lote) con el motivo de cómo se le
 *   entregó, por ejemplo por Talana;
 * - una versión que reemplaza a otra cancela la entrega pendiente de la
 *   anterior: ya no hay nada que entregar de ella.
 *
 * El reporte deja la ejecución `submitted`; aprobarla cierra la obligación, y
 * el indicador de la N°18 la cuenta como un caso a tiempo o fuera de plazo
 * (`compliance.ts`, rama de cobertura).
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpObligations,
  pdtpPrograms,
  sstDocuments,
  sstDocumentTypes,
  sstDocumentVersions,
  workers,
  worksites,
} from "@/db/schema"
import { logger } from "@/lib/logger"
import { RIOHS_DOCUMENT_TYPE_CODE } from "@/lib/prevention/riohs"
import { resolvePdtpActivityIdsForNumbers } from "@/lib/services/pdtp/accreditation"
import { PDTP_COVERAGE_CASE_METADATA_KEY } from "@/lib/services/pdtp/compliance"
import {
  cancelPdtpObligation,
  createPdtpObligation,
  reportPdtpObligation,
} from "@/lib/services/pdtp/obligations"
import { listPdtpProgramOperatingWorksiteIds } from "@/lib/services/pdtp/worksites"
import {
  assessDocumentWorkforceRollout,
  assignDocumentVersionToWorkforce,
} from "@/lib/services/prevention-documents/distribution"
import { chileDateParts } from "@/lib/utils"
import { resolvePdtpProgramActorUserId } from "./obligation-kit"

export const RIOHS_ROLLOUT_ACTIVITY_NUMBER = 18

/** Sujeto de la obligación: el documento, no la versión, para encontrar la de la versión anterior. */
export function riohsRolloutSubjectKey(documentId: string): string {
  return `riohs:${documentId}`
}

export function riohsRolloutSourceId(versionId: string): string {
  return `riohs:${versionId}`
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString()
}

type RolloutVersion = {
  documentId: string
  documentTitle: string
  versionId: string
  versionNumber: number
  worksiteId: string | null
  confidentiality: string
  becameCurrentAt: string
  distributionDueDays: number
}

export type RiohsRolloutOutcome = {
  opened: number
  alreadyOpen: number
  cancelledPrevious: number
  skipped: number
  errors: number
}

/**
 * Faenas de la entrega: la del documento, o las del programa activo del año si
 * el RIOHS es corporativo. Sin programa activo no hay dónde abrir la
 * obligación; la reconciliación semanal la abre cuando se active.
 */
async function rolloutWorksites(version: RolloutVersion): Promise<Array<{ worksiteId: string; programId: string; activityId: string }>> {
  const { year } = chileDateParts(version.becameCurrentAt)
  const programs = await db.select({ id: pdtpPrograms.id }).from(pdtpPrograms)
    .where(and(eq(pdtpPrograms.status, "active"), eq(pdtpPrograms.year, year)))
  const candidateWorksites = new Set<string>()
  if (version.worksiteId) candidateWorksites.add(version.worksiteId)
  else for (const program of programs) for (const id of await listPdtpProgramOperatingWorksiteIds(program.id)) candidateWorksites.add(id)

  const result: Array<{ worksiteId: string; programId: string; activityId: string }> = []
  for (const worksiteId of candidateWorksites) {
    // El motor resuelve qué versión del programa rige esa faena en esa fecha;
    // lanza si la faena no pertenece a ningún programa activo, que acá es un
    // "no aplica", no un error.
    const resolved = await resolvePdtpActivityIdsForNumbers({
      worksiteId,
      occurredAt: version.becameCurrentAt,
      activityNumbers: [RIOHS_ROLLOUT_ACTIVITY_NUMBER],
      sourceType: "documento",
      sourceId: riohsRolloutSourceId(version.versionId),
    }).catch(() => null)
    const activityId = resolved?.activityIdByN.get(RIOHS_ROLLOUT_ACTIVITY_NUMBER)
    if (resolved && activityId) result.push({ worksiteId, programId: resolved.programId, activityId })
  }
  return result
}

async function openRolloutForWorksite(
  version: RolloutVersion,
  target: { worksiteId: string; programId: string; activityId: string },
  actorUserId: string | null,
  outcome: RiohsRolloutOutcome,
) {
  const [headcount] = await db.select({ activeWorkers: sql<number>`count(*)::int` })
    .from(workers).where(and(eq(workers.worksiteId, target.worksiteId), eq(workers.isActive, true)))
  const activeWorkers = Number(headcount?.activeWorkers ?? 0)
  // Una faena sin dotación no tiene a quién entregar: abrir la obligación la
  // dejaría vencer sin que nadie pueda cerrarla.
  if (!activeWorkers) { outcome.skipped += 1; return }

  const subjectKey = riohsRolloutSubjectKey(version.documentId)
  const sourceId = riohsRolloutSourceId(version.versionId)

  // Primero se cancela la entrega de la versión anterior: sigue abierta y ya
  // no hay nada que entregar de ella.
  const previous = await db.select({ id: pdtpObligations.id }).from(pdtpObligations).where(and(
    eq(pdtpObligations.activityId, target.activityId),
    eq(pdtpObligations.worksiteId, target.worksiteId),
    inArray(pdtpObligations.status, ["pending", "overdue"]),
    ne(pdtpObligations.sourceId, sourceId),
    sql`${pdtpObligations.sourceMetadataJson}->>'subjectKey' = ${subjectKey}`,
  ))
  for (const obligation of previous) {
    if (!actorUserId) { outcome.skipped += 1; continue }
    await cancelPdtpObligation({
      obligationId: obligation.id,
      userId: actorUserId,
      reason: `Reemplazada por la versión v${version.versionNumber} del Reglamento Interno, que abre su propia entrega.`,
      scope: "all",
    })
    outcome.cancelledPrevious += 1
  }

  const dueAt = addDays(version.becameCurrentAt, version.distributionDueDays)
  // Primero la obligación: es el hecho que la plataforma debe registrar —la
  // entrega se debe hacer— aunque asignar a la dotación falle después.
  const { created } = await createPdtpObligation({
    activityId: target.activityId,
    worksiteId: target.worksiteId,
    origin: "integration",
    sourceType: "documento",
    sourceId,
    sourceOccurredAt: version.becameCurrentAt,
    dueAt,
    sourceMetadata: {
      subjectKey,
      rollout: "riohs",
      // La N°18 se mide por cobertura; esta entrega es un caso propio (ver
      // `loadClosedOnTimeByActivityMonth` en `compliance.ts`).
      [PDTP_COVERAGE_CASE_METADATA_KEY]: true,
      documentId: version.documentId,
      versionId: version.versionId,
      version: version.versionNumber,
      documentTitle: version.documentTitle,
    },
    userId: actorUserId,
    scope: "all",
  })
  if (created) outcome.opened += 1
  else outcome.alreadyOpen += 1

  // La asignación es un efecto de la plataforma, no un acto del usuario sobre
  // su propio alcance: la versión se entrega a toda la dotación de la faena.
  // Necesita un autor (FK a `users`); sin actor —un barrido sin programa
  // firmado por nadie— queda para "Asignar pendientes" en el detalle del
  // documento, y la reconciliación semanal la reintenta.
  if (!actorUserId) return
  try {
    await assignDocumentVersionToWorkforce({
      ctx: { userId: actorUserId },
      scope: { mode: "all", ids: [] },
      permissions: [],
      versionId: version.versionId,
      worksiteId: target.worksiteId,
      assignmentReason: `Nueva versión del Reglamento Interno (v${version.versionNumber}): entrega a toda la dotación (PDTP N°18).`,
      dueAt,
    })
  } catch (error) {
    outcome.errors += 1
    logger.error("[riohs-rollout] la entrega quedó abierta pero no se pudo asignar a la dotación", {
      versionId: version.versionId,
      worksiteId: target.worksiteId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Llamado después del commit cuando una versión del RIOHS queda vigente. Nunca
 * lanza: la publicación ya ocurrió, y lo que no se pueda abrir ahora lo abre la
 * reconciliación semanal.
 */
export async function onRiohsVersionPublished(input: {
  documentId: string
  documentTitle: string
  versionId: string
  versionNumber: number
  worksiteId: string | null
  becameCurrentAt: string
  distributionDueDays: number | null
  actorUserId: string
}): Promise<RiohsRolloutOutcome> {
  const outcome: RiohsRolloutOutcome = { opened: 0, alreadyOpen: 0, cancelledPrevious: 0, skipped: 0, errors: 0 }
  if (!input.distributionDueDays) return outcome
  try {
    const [doc] = await db.select({ confidentiality: sstDocuments.confidentiality })
      .from(sstDocuments).where(eq(sstDocuments.id, input.documentId)).limit(1)
    if (!doc) return outcome
    const version: RolloutVersion = { ...input, confidentiality: doc.confidentiality, distributionDueDays: input.distributionDueDays }
    await openRollout(version, input.actorUserId, outcome)
  } catch (error) {
    outcome.errors += 1
    logger.error("[riohs-rollout] no se pudo abrir la entrega del RIOHS", {
      versionId: input.versionId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return outcome
}

async function openRollout(version: RolloutVersion, actorUserId: string | null, outcome: RiohsRolloutOutcome) {
  // El reglamento se entrega a todas las personas: uno restringido o sensible
  // no puede repartirse a la dotación, y forzarlo sería filtrarlo.
  if (version.confidentiality !== "publico_interno") {
    outcome.skipped += 1
    logger.warn("[riohs-rollout] RIOHS no público interno: no se abre entrega a la dotación", { versionId: version.versionId })
    return
  }
  for (const target of await rolloutWorksites(version)) {
    try {
      await openRolloutForWorksite(version, target, actorUserId, outcome)
    } catch (error) {
      outcome.errors += 1
      logger.error("[riohs-rollout] no se pudo abrir la entrega en una faena", {
        versionId: version.versionId,
        worksiteId: target.worksiteId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

/**
 * Tras un acuse o una exención: si la faena ya recibió completa la versión, se
 * reporta su obligación N°18. Idempotente —una obligación ya reportada no se
 * vuelve a abrir— y nunca lanza.
 */
export async function onRiohsRolloutProgress(input: {
  versionId: string
  worksiteIds: Array<string | null>
  actorUserId: string
}): Promise<{ reported: number }> {
  let reported = 0
  try {
    const worksiteIds = [...new Set(input.worksiteIds.filter((id): id is string => Boolean(id)))]
    if (worksiteIds.length === 0) return { reported }
    const open = await db.select({
      id: pdtpObligations.id,
      worksiteId: pdtpObligations.worksiteId,
      metadata: pdtpObligations.sourceMetadataJson,
    }).from(pdtpObligations).where(and(
      eq(pdtpObligations.sourceType, "documento"),
      eq(pdtpObligations.sourceId, riohsRolloutSourceId(input.versionId)),
      inArray(pdtpObligations.worksiteId, worksiteIds),
      inArray(pdtpObligations.status, ["pending", "overdue"]),
    ))
    for (const obligation of open) {
      if (await reportRolloutIfComplete(obligation, input.versionId, input.actorUserId)) reported += 1
    }
  } catch (error) {
    logger.error("[riohs-rollout] no se pudo evaluar el avance de la entrega", {
      versionId: input.versionId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return { reported }
}

async function reportRolloutIfComplete(
  obligation: { id: string; worksiteId: string; metadata: unknown },
  versionId: string,
  actorUserId: string,
): Promise<boolean> {
  const rollout = await assessDocumentWorkforceRollout(versionId, obligation.worksiteId)
  if (!rollout.complete) return false
  const [site] = await db.select({ name: worksites.name }).from(worksites).where(eq(worksites.id, obligation.worksiteId)).limit(1)
  const metadata = (obligation.metadata ?? {}) as { version?: number; documentTitle?: string }
  await reportPdtpObligation({
    obligationId: obligation.id,
    executedQuantity: 1,
    evidenceText: `Reglamento Interno v${metadata.version ?? "?"} entregado a la dotación de ${site?.name ?? "la faena"}: `
      + `${rollout.acknowledged} acuse(s) y ${rollout.exempt} exención(es) sobre ${rollout.active} trabajador(es) activos.`,
    userId: actorUserId,
    scope: "all",
  })
  return true
}

/**
 * Reconciliación semanal de las entregas del RIOHS:
 *
 * - abre la entrega de la versión vigente de cada RIOHS en las faenas donde
 *   todavía no existe (la versión se publicó antes de activar el programa, o
 *   el programa sumó una faena);
 * - asigna la versión a quien se incorporó a la dotación después;
 * - reporta las entregas que se completaron por una baja de la dotación;
 * - cancela las entregas de versiones que ya no son la vigente.
 */
export async function reconcilePdtpRiohsRollouts(now = new Date()): Promise<RiohsRolloutOutcome & { reported: number }> {
  const outcome: RiohsRolloutOutcome & { reported: number } = { opened: 0, alreadyOpen: 0, cancelledPrevious: 0, skipped: 0, errors: 0, reported: 0 }
  const { year } = chileDateParts(now)
  const [program] = await db.select({ id: pdtpPrograms.id, activatedAt: pdtpPrograms.activatedAt }).from(pdtpPrograms)
    .where(and(eq(pdtpPrograms.status, "active"), eq(pdtpPrograms.year, year))).limit(1)
  if (!program) return outcome
  const actorUserId = await resolvePdtpProgramActorUserId(program.id)

  const current = await db.select({
    documentId: sstDocuments.id,
    documentTitle: sstDocuments.title,
    worksiteId: sstDocuments.worksiteId,
    confidentiality: sstDocuments.confidentiality,
    versionId: sstDocumentVersions.id,
    versionNumber: sstDocumentVersions.version,
    effectiveFrom: sstDocumentVersions.effectiveFrom,
    updatedAt: sstDocumentVersions.updatedAt,
    distributionDueDays: sstDocumentTypes.distributionDueDays,
  })
    .from(sstDocuments)
    .innerJoin(sstDocumentTypes, eq(sstDocumentTypes.id, sstDocuments.typeId))
    .innerJoin(sstDocumentVersions, eq(sstDocumentVersions.id, sstDocuments.currentVersionId))
    .where(and(
      eq(sstDocumentTypes.code, RIOHS_DOCUMENT_TYPE_CODE),
      eq(sstDocuments.status, "vigente"),
      eq(sstDocumentVersions.status, "vigente"),
    ))
  const currentVersionIds = new Set(current.map((row) => row.versionId))

  for (const row of current) {
    if (!row.distributionDueDays) continue
    // Sólo una versión que empezó a regir en el año del programa: la vigente
    // de un año anterior ya se entregó bajo ese programa.
    const versionStart = row.effectiveFrom ? `${row.effectiveFrom}T12:00:00.000Z` : row.updatedAt
    if (chileDateParts(versionStart).year !== year) continue
    // Una versión que ya regía cuando se activó el programa abre su entrega
    // desde la activación: contar el plazo desde antes la haría nacer vencida
    // por un compromiso que todavía no existía.
    const becameCurrentAt = program.activatedAt && program.activatedAt > versionStart ? program.activatedAt : versionStart
    const version: RolloutVersion = {
      documentId: row.documentId,
      documentTitle: row.documentTitle,
      versionId: row.versionId,
      versionNumber: row.versionNumber,
      worksiteId: row.worksiteId,
      confidentiality: row.confidentiality,
      becameCurrentAt,
      distributionDueDays: row.distributionDueDays,
    }
    await openRollout(version, actorUserId, outcome)
  }

  // Entregas abiertas: las de una versión que dejó de ser la vigente se
  // cancelan; el resto se reevalúa (una baja pudo completarlas).
  const open = await db.select({
    id: pdtpObligations.id,
    worksiteId: pdtpObligations.worksiteId,
    sourceId: pdtpObligations.sourceId,
    metadata: pdtpObligations.sourceMetadataJson,
  }).from(pdtpObligations).where(and(
    eq(pdtpObligations.programId, program.id),
    eq(pdtpObligations.sourceType, "documento"),
    inArray(pdtpObligations.status, ["pending", "overdue"]),
    sql`${pdtpObligations.sourceMetadataJson}->>'rollout' = 'riohs'`,
  ))
  for (const obligation of open) {
    const versionId = (obligation.sourceId ?? "").replace(/^riohs:/, "")
    try {
      if (!currentVersionIds.has(versionId)) {
        if (!actorUserId) { outcome.skipped += 1; continue }
        await cancelPdtpObligation({
          obligationId: obligation.id,
          userId: actorUserId,
          reason: "La versión del Reglamento Interno ya no es la vigente: no queda nada que entregar de ella.",
          scope: "all",
        })
        outcome.cancelledPrevious += 1
      } else if (actorUserId && await reportRolloutIfComplete(obligation, versionId, actorUserId)) {
        outcome.reported += 1
      }
    } catch (error) {
      outcome.errors += 1
      logger.error("[riohs-rollout] reconciliación: error en una entrega", {
        obligationId: obligation.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return outcome
}

/** Estado de la entrega por faena, para la tarjeta del detalle del documento. */
export async function listRiohsRolloutStatus(versionId: string, worksiteIds: string[]) {
  const obligations = worksiteIds.length === 0 ? [] : await db.select({
    worksiteId: pdtpObligations.worksiteId,
    status: pdtpObligations.status,
    dueAt: pdtpObligations.dueAt,
    reportedAt: pdtpObligations.reportedAt,
  }).from(pdtpObligations).where(and(
    eq(pdtpObligations.sourceType, "documento"),
    eq(pdtpObligations.sourceId, riohsRolloutSourceId(versionId)),
    inArray(pdtpObligations.worksiteId, worksiteIds),
  ))
  const obligationByWorksite = new Map(obligations.map((row) => [row.worksiteId, row]))
  const sites = worksiteIds.length === 0 ? [] : await db.select({ id: worksites.id, name: worksites.name })
    .from(worksites).where(inArray(worksites.id, worksiteIds))
  const nameById = new Map(sites.map((site) => [site.id, site.name]))
  const now = Date.now()
  return Promise.all(worksiteIds.map(async (worksiteId) => {
    const rollout = await assessDocumentWorkforceRollout(versionId, worksiteId)
    const obligation = obligationByWorksite.get(worksiteId) ?? null
    return {
      ...rollout,
      worksiteName: nameById.get(worksiteId) ?? worksiteId,
      obligation: obligation ? {
        status: obligation.status,
        dueAt: obligation.dueAt,
        overdue: obligation.status === "overdue"
          || (obligation.status === "pending" && Boolean(obligation.dueAt && new Date(obligation.dueAt).getTime() < now)),
      } : null,
    }
  }))
}

/**
 * Faenas en las que aplica la entrega de un RIOHS hoy: la del documento o, si
 * es corporativo, las del programa activo del año. Para la vista del detalle.
 */
export async function listRiohsRolloutWorksiteIds(documentWorksiteId: string | null, now = new Date()): Promise<string[]> {
  if (documentWorksiteId) return [documentWorksiteId]
  const { year } = chileDateParts(now)
  const [program] = await db.select({ id: pdtpPrograms.id }).from(pdtpPrograms)
    .where(and(eq(pdtpPrograms.status, "active"), eq(pdtpPrograms.year, year))).limit(1)
  return program ? listPdtpProgramOperatingWorksiteIds(program.id) : []
}
