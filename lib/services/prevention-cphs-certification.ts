/**
 * Expediente de certificación CPHS de Mutual de Seguridad CChC.
 *
 * Decisión de diseño: los requisitos automáticos se evalúan **en vivo** mientras
 * el expediente está en preparación, y se **congelan** al presentarlo. Una
 * brecha tiene que estar al día para ser accionable, pero un expediente cuyo
 * contenido cambia solo no sirve como evidencia frente a una auditoría.
 *
 * Las brechas no tienen tablero propio: al presentar, cada requisito incumplido
 * abre una acción CAPA con el plazo de 60 días de Mutual, y desde ahí entra en
 * `/pendientes` por la fuente `capa` que ya existe.
 */

import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm"
import { z } from "zod"
import { db, type DB, type Tx } from "@/db"
import {
  preventionCertificationDossiers,
  preventionCertificationEvaluations,
  preventionCommitteeAgreements,
  preventionCommitteeAttendance,
  preventionCommitteeCommissionMembers,
  preventionCommitteeCommissions,
  preventionCommitteeMeetings,
  preventionCommitteeMembers,
  preventionCommitteeProgramActivities,
  preventionCommitteePrograms,
  preventionCommittees,
  preventionCompetencyRequirements,
  preventionIncidentInvestigations,
  preventionIncidents,
  preventionInspectionRuns,
  preventionRiskMapLayouts,
  preventionRiskMapMarkers,
  preventionRiskMatrices,
  preventionWorkerCompetencies,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { assessCommitteeParity, isMandateExpired } from "@/lib/prevention/cphs"
import {
  CERTIFICATION_LEVEL_LABELS,
  GAP_CLOSURE_DAYS,
  evaluateLevel,
  findRequirement,
  summarizeEvaluation,
  type CertificationEvidence,
  type CertificationLevel,
  type EvaluatedRequirement,
} from "@/lib/prevention/cphs-certification"
import { createCapaActionWithClient } from "@/lib/services/prevention-capa"
import {
  CPHS_NOT_FOUND,
  nowIso,
  recordGovernanceHistory,
  requireCphsAccess,
  type CphsAccess,
} from "@/lib/services/prevention-cphs-access"
// La copia de `prevention-cphs-access` no admite argumento: acá hay que fechar
// timestamps ajenos (`heldAt`, `executedAt`), no sólo "ahora".
import { todayInChile } from "@/lib/utils"

const LEVELS = ["bronce", "plata", "oro"] as const

type StoredCertificationEvaluation = typeof preventionCertificationEvaluations.$inferSelect
type ManualCertificationEvaluation = {
  status: "met" | "not_met" | "not_applicable"
  detail: string
  evidenceReference: string | null
}

function indexCertificationEvaluations(rows: readonly StoredCertificationEvaluation[]) {
  const byRequirement = new Map<string, StoredCertificationEvaluation>()
  const manual = new Map<string, ManualCertificationEvaluation>()

  for (const row of rows) {
    byRequirement.set(row.requirementCode, row)
    if (row.source === "manual") {
      manual.set(row.requirementCode, {
        status: row.status as ManualCertificationEvaluation["status"],
        detail: row.detail ?? "",
        evidenceReference: row.evidenceReference,
      })
    }
  }

  return { byRequirement, manual }
}

/**
 * Año y mes civiles chilenos de un timestamp.
 *
 * Los `timestamptz` se guardan en UTC, así que cortarlos con `.slice(0, 7)`
 * mide el mes en UTC: lo ocurrido después de las 21:00 del último día del mes
 * se contaba en el mes siguiente —y el 31 de diciembre, en el año siguiente—.
 * Sobre un requisito de "N meses con sesión" eso cambia el resultado.
 */
function chileYear(timestamp: string): string {
  return todayInChile(timestamp).slice(0, 4)
}

function chileMonth(timestamp: string): string {
  return todayInChile(timestamp).slice(0, 7)
}

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00.000Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

async function loadDossier(dossierId: string, client: DB | Tx = db) {
  const [row] = await client.select({
    dossier: preventionCertificationDossiers,
    committeeId: preventionCommittees.id,
    committeeName: preventionCommittees.name,
    worksiteId: preventionCommittees.worksiteId,
  })
    .from(preventionCertificationDossiers)
    .innerJoin(preventionCommittees, eq(preventionCommittees.id, preventionCertificationDossiers.committeeId))
    .where(eq(preventionCertificationDossiers.id, dossierId))
    .limit(1)
  if (!row) throw new Error(CPHS_NOT_FOUND)
  return row
}

/* ── Evidencia ────────────────────────────────────────────────────────────── */

/**
 * Reúne del sistema todo lo que los requisitos automáticos necesitan. El
 * período es el año calendario del expediente, acotado a hoy: en marzo se
 * evalúan tres meses, no doce.
 */
export async function gatherCertificationEvidence(args: {
  committeeId: string
  worksiteId: string
  periodYear: number
}, client: DB | Tx = db): Promise<CertificationEvidence> {
  const today = todayInChile()
  const periodStart = `${args.periodYear}-01-01`
  const periodEnd = `${args.periodYear}-12-31`
  const cappedEnd = today < periodEnd ? today : periodEnd
  const monthsElapsed = cappedEnd < periodStart ? 0 : Number(cappedEnd.slice(5, 7))

  const [
    [committeeRow],
    memberRows,
    meetingRows,
    agreementRows,
    programRows,
    incidentRows,
    requirementRows,
    inspectionRows,
    iperRows,
    guestRows,
    commissionRows,
    riskMapRows,
  ] = await Promise.all([
    client.select().from(preventionCommittees)
      .where(eq(preventionCommittees.id, args.committeeId)).limit(1),
    client.select().from(preventionCommitteeMembers)
      .where(eq(preventionCommitteeMembers.committeeId, args.committeeId)),
    client.select({
      closedAt: preventionCommitteeMeetings.closedAt,
      heldAt: preventionCommitteeMeetings.heldAt,
      scheduledFor: preventionCommitteeMeetings.scheduledFor,
      status: preventionCommitteeMeetings.status,
      agendaSentAt: preventionCommitteeMeetings.agendaSentAt,
      sentToManagementAt: preventionCommitteeMeetings.sentToManagementAt,
    })
      .from(preventionCommitteeMeetings)
      .where(eq(preventionCommitteeMeetings.committeeId, args.committeeId)),
    client.select({
      id: preventionCommitteeAgreements.id,
      capaActionId: preventionCommitteeAgreements.capaActionId,
      createdAt: preventionCommitteeAgreements.createdAt,
    })
      .from(preventionCommitteeAgreements)
      .innerJoin(preventionCommitteeMeetings, eq(preventionCommitteeMeetings.id, preventionCommitteeAgreements.meetingId))
      .where(eq(preventionCommitteeMeetings.committeeId, args.committeeId)),
    client.select({
      status: preventionCommitteePrograms.status,
      activities: sql<number>`count(${preventionCommitteeProgramActivities.id})::int`,
    })
      .from(preventionCommitteePrograms)
      .leftJoin(preventionCommitteeProgramActivities, eq(preventionCommitteeProgramActivities.programId, preventionCommitteePrograms.id))
      .where(and(
        eq(preventionCommitteePrograms.committeeId, args.committeeId),
        eq(preventionCommitteePrograms.year, args.periodYear),
      ))
      .groupBy(preventionCommitteePrograms.status),
    client.select({
      id: preventionIncidents.id,
      investigationStatus: preventionIncidentInvestigations.status,
    })
      .from(preventionIncidents)
      .leftJoin(preventionIncidentInvestigations, eq(preventionIncidentInvestigations.incidentId, preventionIncidents.id))
      .where(and(
        eq(preventionIncidents.worksiteId, args.worksiteId),
        gte(preventionIncidents.occurredAt, `${periodStart}T00:00:00.000Z`),
        lte(preventionIncidents.occurredAt, `${periodEnd}T23:59:59.999Z`),
      )),
    // Los cursos exigidos a los integrantes se declaran como requisitos de
    // competencia con alcance `committee` apuntando a este comité.
    client.select({ courseId: preventionCompetencyRequirements.courseId })
      .from(preventionCompetencyRequirements)
      .where(and(
        eq(preventionCompetencyRequirements.scopeType, "committee"),
        eq(preventionCompetencyRequirements.scopeValue, args.committeeId),
        eq(preventionCompetencyRequirements.isActive, true),
      )),
    // Evidencia de los niveles Plata y Oro. Se consulta siempre porque el
    // expediente muestra el nivel completo aunque sólo se presente Bronce.
    client.select({ executedAt: preventionInspectionRuns.executedAt, origin: preventionInspectionRuns.origin })
      .from(preventionInspectionRuns)
      .where(and(
        eq(preventionInspectionRuns.worksiteId, args.worksiteId),
        inArray(preventionInspectionRuns.status, ["completed", "reviewed"]),
      )),
    client.select({
      createdAt: preventionRiskMatrices.createdAt,
      committeeMeetingId: preventionRiskMatrices.committeeMeetingId,
    })
      .from(preventionRiskMatrices)
      .where(eq(preventionRiskMatrices.worksiteId, args.worksiteId)),
    client.select({ scheduledFor: preventionCommitteeMeetings.scheduledFor })
      .from(preventionCommitteeAttendance)
      .innerJoin(preventionCommitteeMeetings, eq(preventionCommitteeMeetings.id, preventionCommitteeAttendance.meetingId))
      .where(and(
        eq(preventionCommitteeMeetings.committeeId, args.committeeId),
        isNull(preventionCommitteeAttendance.memberId),
        eq(preventionCommitteeAttendance.attended, true),
      )),
    // Una comisión sin integrantes asignados no acredita organización interna.
    client.select({ id: preventionCommitteeCommissions.id })
      .from(preventionCommitteeCommissions)
      .innerJoin(preventionCommitteeCommissionMembers, eq(preventionCommitteeCommissionMembers.commissionId, preventionCommitteeCommissions.id))
      .where(and(
        eq(preventionCommitteeCommissions.committeeId, args.committeeId),
        eq(preventionCommitteeCommissions.isActive, true),
      ))
      .groupBy(preventionCommitteeCommissions.id),
    // Igual criterio que las demás consultas de esta función: lectura directa
    // sobre la tabla, sin pasar por el permiso `prevention:risk:view` del
    // servicio de mapas — la certificación ya está gateada por
    // `prevention:cphs:certify`, no por los permisos de MIPER del certificador.
    client.select({
      layoutId: preventionRiskMapLayouts.id,
      markerCount: sql<number>`count(${preventionRiskMapMarkers.id})::int`,
    })
      .from(preventionRiskMapLayouts)
      .leftJoin(preventionRiskMapMarkers, eq(preventionRiskMapMarkers.layoutId, preventionRiskMapLayouts.id))
      .where(and(eq(preventionRiskMapLayouts.worksiteId, args.worksiteId), eq(preventionRiskMapLayouts.status, "active")))
      .groupBy(preventionRiskMapLayouts.id),
  ])

  const activeMembers = memberRows.filter((member) => member.status === "active")
  const parity = assessCommitteeParity(memberRows.map((member) => ({
    id: member.id,
    representation: member.representation,
    seat: member.seat,
    role: member.role,
    status: member.status,
  })))
  const periodYear = String(args.periodYear)
  const inspectionMonths = new Set<string>()
  const committeeInspectionMonths = new Set<string>()
  for (const row of inspectionRows) {
    if (row.executedAt === null || chileYear(row.executedAt) !== periodYear) continue
    const month = chileMonth(row.executedAt)
    inspectionMonths.add(month)
    if (row.origin === "cphs") committeeInspectionMonths.add(month)
  }
  const monthsWithInspection = inspectionMonths.size
  const monthsWithCommitteeInspection = committeeInspectionMonths.size
  const periodIper = iperRows.filter((row) => chileYear(row.createdAt) === periodYear)

  const monthsWithGuest = new Set<string>()
  for (const row of guestRows) {
    if (chileYear(row.scheduledFor) === periodYear) {
      monthsWithGuest.add(chileMonth(row.scheduledFor))
    }
  }

  // Una sesión cuenta en el mes en que OCURRIÓ, no en el que se firmó el acta.
  // Con `closedAt`, el acta de la sesión de enero cerrada el 3 de febrero
  // contaba como febrero: un comité que sesionó los doce meses podía quedar
  // bajo el requisito de "N meses con sesión" —y sobra un mes duplicado donde
  // se cerraron dos actas juntas—. `heldAt` es la fecha del hecho y
  // `closeCommitteeMeeting` siempre la exige; `closedAt` sólo queda de respaldo
  // por si alguna fila antigua la tuviera nula, para no descontar la sesión.
  const closedInPeriod = meetingRows.flatMap((row) => {
    if (row.status !== "closed") return []
    const occurredAt = row.heldAt ?? row.closedAt
    if (occurredAt === null || chileYear(occurredAt) !== periodYear) return []
    return [{ ...row, heldOn: chileMonth(occurredAt) }]
  })
  const monthsWithClosedMeeting = new Set(closedInPeriod.map((row) => row.heldOn)).size
  // Las canceladas no cuentan como sesión convocada para la tabla previa.
  const convenedInPeriod = meetingRows.filter((row) =>
    row.status !== "cancelled" && chileYear(row.scheduledFor) === periodYear)

  const periodAgreements = agreementRows.filter((row) => chileYear(row.createdAt) === periodYear)
  const activeProgram = programRows.find((row) => row.status === "active")

  const requiredCourseIds = [...new Set(requirementRows.map((row) => row.courseId))]
  let orientationCovered = 0
  if (requiredCourseIds.length > 0 && activeMembers.length > 0) {
    const competencies = await client.select({
      workerId: preventionWorkerCompetencies.workerId,
      courseId: preventionWorkerCompetencies.courseId,
      expiresAt: preventionWorkerCompetencies.expiresAt,
    })
      .from(preventionWorkerCompetencies)
      .where(and(
        inArray(preventionWorkerCompetencies.workerId, activeMembers.map((member) => member.workerId)),
        inArray(preventionWorkerCompetencies.courseId, requiredCourseIds),
        eq(preventionWorkerCompetencies.status, "valid"),
      ))

    const byWorker = new Map<string, Set<string>>()
    for (const row of competencies) {
      if (row.expiresAt !== null && row.expiresAt < today) continue
      const set = byWorker.get(row.workerId)
      if (set) set.add(row.courseId)
      else byWorker.set(row.workerId, new Set([row.courseId]))
    }
    // Cubierto = tiene vigentes TODOS los cursos exigidos al comité.
    orientationCovered = activeMembers.filter((member) =>
      requiredCourseIds.every((courseId) => byWorker.get(member.workerId)?.has(courseId))).length
  }

  return {
    committeeActive: Boolean(committeeRow)
      && committeeRow!.status === "active"
      && !isMandateExpired(committeeRow!.mandateEndsOn, today),
    dtRegisteredOn: committeeRow?.dtRegisteredOn ?? null,
    parityValid: parity.valid,
    parityIssues: parity.issues.map((issue) => issue.detail),
    hasPresident: activeMembers.some((member) => member.role === "presidente"),
    hasSecretary: activeMembers.some((member) => member.role === "secretario"),
    hasFuero: activeMembers.some((member) => member.hasFuero),
    activeMembers: activeMembers.length,
    monthsWithClosedMeeting,
    monthsElapsed,
    agreementsTotal: periodAgreements.length,
    agreementsWithCapa: periodAgreements.filter((row) => row.capaActionId !== null).length,
    programActive: Boolean(activeProgram),
    programActivities: activeProgram?.activities ?? 0,
    orientationCovered,
    incidentsTotal: incidentRows.length,
    incidentsInvestigated: incidentRows.filter((row) => row.investigationStatus === "completed").length,
    requiredCourseCount: requiredCourseIds.length,
    monthsWithInspection,
    monthsWithCommitteeInspection,
    iperRevisionsTotal: periodIper.length,
    iperRevisionsWithCommittee: periodIper.filter((row) => row.committeeMeetingId !== null).length,
    meetingsInPeriod: convenedInPeriod.length,
    meetingsWithAgendaSent: convenedInPeriod.filter((row) => row.agendaSentAt !== null).length,
    monthsWithGuest: monthsWithGuest.size,
    closedMeetingsInPeriod: closedInPeriod.length,
    minutesSentToManagement: closedInPeriod.filter((row) => row.sentToManagementAt !== null).length,
    activeCommissions: commissionRows.length,
    riskMapActive: riskMapRows.length > 0,
    riskMapMarkerCount: riskMapRows.reduce((sum, row) => sum + row.markerCount, 0),
  }
}

/* ── Expediente ───────────────────────────────────────────────────────────── */

const createDossierSchema = z.object({
  committeeId: z.string().min(1),
  level: z.enum(LEVELS).default("bronce"),
  periodYear: z.number().int().min(2020).max(2100),
})

export async function createCertificationDossier(input: unknown, access: CphsAccess) {
  const data = createDossierSchema.parse(input)

  return db.transaction(async (tx) => {
    const [committee] = await tx.select().from(preventionCommittees)
      .where(eq(preventionCommittees.id, data.committeeId)).limit(1)
    if (!committee) throw new Error(CPHS_NOT_FOUND)
    requireCphsAccess(access, "prevention:cphs:certify", committee.worksiteId)

    const [existing] = await tx.select({ id: preventionCertificationDossiers.id })
      .from(preventionCertificationDossiers)
      .where(and(
        eq(preventionCertificationDossiers.committeeId, data.committeeId),
        eq(preventionCertificationDossiers.level, data.level),
        eq(preventionCertificationDossiers.periodYear, data.periodYear),
      )).limit(1)
    if (existing) {
      throw new Error(`Ya existe un expediente ${CERTIFICATION_LEVEL_LABELS[data.level]} ${data.periodYear} para este comité.`)
    }

    const [created] = await tx.insert(preventionCertificationDossiers).values({
      id: `certexp-${nanoid()}`,
      committeeId: data.committeeId,
      level: data.level,
      periodYear: data.periodYear,
      auditedFrom: `${data.periodYear}-01-01`,
      auditedTo: `${data.periodYear}-12-31`,
      createdByUserId: access.userId,
    }).returning()
    if (!created) throw new Error("No se pudo crear el expediente de certificación.")

    await recordGovernanceHistory(tx, {
      entityType: "certification_dossier",
      entityId: created.id,
      worksiteId: committee.worksiteId,
      changeType: "created",
      reason: `Expediente ${CERTIFICATION_LEVEL_LABELS[data.level]} ${data.periodYear}`,
      afterState: created,
      actorUserId: access.userId,
    })
    return created
  })
}

export interface DossierStatus {
  dossier: typeof preventionCertificationDossiers.$inferSelect
  committeeName: string
  worksiteId: string
  requirements: EvaluatedRequirement[]
  summary: ReturnType<typeof summarizeEvaluation>
  /** `true` cuando el expediente ya está congelado y lo mostrado es el snapshot. */
  frozen: boolean
  gaps: Array<{ code: string; title: string; capaActionId: string | null }>
}

/**
 * En preparación devuelve la evaluación en vivo; presentado o cerrado devuelve
 * el snapshot guardado, que es lo que se auditó.
 */
export async function getCertificationDossier(dossierId: string, access: CphsAccess): Promise<DossierStatus | null> {
  const context = await loadDossier(dossierId).catch(() => null)
  if (!context) return null
  requireCphsAccess(access, "prevention:cphs:view", context.worksiteId)

  const stored = await db.select().from(preventionCertificationEvaluations)
    .where(eq(preventionCertificationEvaluations.dossierId, dossierId))
  const { byRequirement, manual } = indexCertificationEvaluations(stored)
  const frozen = context.dossier.status !== "draft"

  let requirements: EvaluatedRequirement[]
  if (frozen) {
    // Una fila de otro nivel no es parte de este expediente: se ignora en vez de
    // contarla como requisito (filas así sólo pueden venir de antes de que
    // `recordManualEvaluation` validara el nivel). Un código que ya no está en
    // el catálogo sí se muestra: era válido cuando se congeló.
    requirements = stored.flatMap((row) => {
      const definition = findRequirement(row.requirementCode)
      if (definition && definition.level !== context.dossier.level) return []
      return [{
        code: row.requirementCode,
        title: definition?.title ?? row.requirementCode,
        description: definition?.description ?? "",
        source: row.source as "auto" | "manual",
        status: row.status as EvaluatedRequirement["status"],
        detail: row.detail ?? "",
        evidenceReference: row.evidenceReference,
      }]
    })
  } else {
    const evidence = await gatherCertificationEvidence({
      committeeId: context.committeeId,
      worksiteId: context.worksiteId,
      periodYear: context.dossier.periodYear,
    })
    requirements = evaluateLevel(context.dossier.level as CertificationLevel, evidence, manual)
  }

  const gaps: DossierStatus["gaps"] = []
  for (const requirement of requirements) {
    if (requirement.status === "not_met") {
      gaps.push({
        code: requirement.code,
        title: requirement.title,
        capaActionId: byRequirement.get(requirement.code)?.capaActionId ?? null,
      })
    }
  }
  return {
    dossier: context.dossier,
    committeeName: context.committeeName,
    worksiteId: context.worksiteId,
    requirements,
    summary: summarizeEvaluation(requirements),
    frozen,
    gaps,
  }
}

const manualEvaluationSchema = z.object({
  dossierId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  requirementCode: z.string().min(1),
  status: z.enum(["met", "not_met", "not_applicable"]),
  detail: z.string().trim().min(10).max(2000),
  evidenceReference: z.string().trim().min(3).max(500).optional(),
})

/** Sólo los requisitos declarados manuales admiten declaración. */
export async function recordManualEvaluation(input: unknown, access: CphsAccess) {
  const data = manualEvaluationSchema.parse(input)
  const definition = findRequirement(data.requirementCode)
  if (!definition) throw new Error("El requisito indicado no existe en el catálogo.")
  if (definition.check.kind !== "manual") {
    throw new Error("Este requisito lo evalúa el sistema con los datos del período: no admite declaración manual.")
  }
  if (!data.evidenceReference) {
    throw new Error("Indica la evidencia que respalda la declaración manual.")
  }

  return db.transaction(async (tx) => {
    const context = await loadDossier(data.dossierId, tx)
    requireCphsAccess(access, "prevention:cphs:certify", context.worksiteId)
    // El nivel sólo se conoce con el expediente cargado: sin esto se podía
    // declarar un requisito de Plata u Oro dentro de un expediente Bronce y la
    // fila quedaba guardada sin pertenecer al nivel auditado.
    const dossierLevel = context.dossier.level as CertificationLevel
    if (definition.level !== dossierLevel) {
      throw new Error(`El requisito «${definition.title}» es del nivel ${CERTIFICATION_LEVEL_LABELS[definition.level]} y este expediente audita ${CERTIFICATION_LEVEL_LABELS[dossierLevel]}.`)
    }
    if (context.dossier.status !== "draft") {
      throw new Error("El expediente ya fue presentado: no admite cambios.")
    }
    if (context.dossier.version !== data.expectedVersion) {
      throw new Error("El expediente cambió mientras lo editabas. Recarga y reintenta.")
    }

    const [versioned] = await tx.update(preventionCertificationDossiers).set({
      version: context.dossier.version + 1,
      updatedAt: nowIso(),
    }).where(and(
      eq(preventionCertificationDossiers.id, data.dossierId),
      eq(preventionCertificationDossiers.status, "draft"),
      eq(preventionCertificationDossiers.version, data.expectedVersion),
    )).returning({ version: preventionCertificationDossiers.version })
    if (!versioned) throw new Error("El expediente cambió mientras lo editabas. Recarga y reintenta.")

    const [saved] = await tx.insert(preventionCertificationEvaluations).values({
      id: `certev-${nanoid()}`,
      dossierId: data.dossierId,
      requirementCode: data.requirementCode,
      status: data.status,
      source: "manual",
      detail: data.detail,
      evidenceReference: data.evidenceReference,
      evaluatedByUserId: access.userId,
    }).onConflictDoUpdate({
      target: [preventionCertificationEvaluations.dossierId, preventionCertificationEvaluations.requirementCode],
      set: {
        status: data.status,
        detail: data.detail,
        evidenceReference: data.evidenceReference,
        evaluatedAt: nowIso(),
        evaluatedByUserId: access.userId,
      },
    }).returning()
    if (!saved) throw new Error("No se pudo guardar la evaluación.")
    return saved
  })
}

const submitSchema = z.object({
  dossierId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
})

/**
 * Congela el expediente y convierte cada brecha en una acción CAPA con el plazo
 * de 60 días de Mutual. No exige estar al 100%: presentar con brechas conocidas
 * y su plan de cierre es exactamente lo que el proceso admite.
 */
export async function submitCertificationDossier(input: unknown, access: CphsAccess) {
  const data = submitSchema.parse(input)
  return db.transaction(async (tx) => {
    const context = await loadDossier(data.dossierId, tx)
    requireCphsAccess(access, "prevention:cphs:certify", context.worksiteId)
    if (context.dossier.status !== "draft") throw new Error("El expediente ya fue presentado.")
    if (context.dossier.version !== data.expectedVersion) {
      throw new Error("El expediente cambió mientras lo editabas. Recarga y reintenta.")
    }

    const today = todayInChile()
    const gapsDeadline = addDays(today, GAP_CLOSURE_DAYS)
    const [updated] = await tx.update(preventionCertificationDossiers).set({
      status: "submitted",
      submittedAt: nowIso(),
      submittedByUserId: access.userId,
      gapsDeadlineOn: gapsDeadline,
      version: context.dossier.version + 1,
      updatedAt: nowIso(),
    }).where(and(
      eq(preventionCertificationDossiers.id, data.dossierId),
      eq(preventionCertificationDossiers.status, "draft"),
      eq(preventionCertificationDossiers.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("El expediente cambió mientras lo editabas. Recarga y reintenta.")

    // La reserva de versión ocurre antes de reunir/congelar evidencia. Así una
    // declaración manual concurrente no puede colarse entre el snapshot y el
    // cambio de estado: su propio CAS falla y toda su transacción revierte.
    const [evidence, stored] = await Promise.all([
      gatherCertificationEvidence({
        committeeId: context.committeeId,
        worksiteId: context.worksiteId,
        periodYear: context.dossier.periodYear,
      }, tx),
      tx.select().from(preventionCertificationEvaluations)
        .where(eq(preventionCertificationEvaluations.dossierId, data.dossierId)),
    ])
    const { byRequirement, manual } = indexCertificationEvaluations(stored)
    const requirements = evaluateLevel(context.dossier.level as CertificationLevel, evidence, manual)

    for (const requirement of requirements) {
      let capaActionId: string | null = byRequirement.get(requirement.code)?.capaActionId ?? null

      if (requirement.status === "not_met" && !capaActionId) {
        const capa = await createCapaActionWithClient(tx, {
          sourceType: "cphs",
          sourceId: data.dossierId,
          worksiteId: context.worksiteId,
          finding: `Brecha de certificación ${CERTIFICATION_LEVEL_LABELS[context.dossier.level as CertificationLevel]}: ${requirement.title}`,
          actionDescription: `${requirement.description} Estado al presentar: ${requirement.detail}`,
          priority: "high",
          targetDate: gapsDeadline,
          evidenceRequired: true,
        }, access.userId)
        capaActionId = capa.id
      }

      await tx.insert(preventionCertificationEvaluations).values({
        id: `certev-${nanoid()}`,
        dossierId: data.dossierId,
        requirementCode: requirement.code,
        status: requirement.status,
        source: requirement.source,
        detail: requirement.detail,
        evidenceReference: requirement.evidenceReference,
        capaActionId,
        evaluatedByUserId: access.userId,
      }).onConflictDoUpdate({
        target: [preventionCertificationEvaluations.dossierId, preventionCertificationEvaluations.requirementCode],
        set: {
          status: requirement.status,
          source: requirement.source,
          detail: requirement.detail,
          evidenceReference: requirement.evidenceReference,
          capaActionId,
          evaluatedAt: nowIso(),
          evaluatedByUserId: access.userId,
        },
      })
    }

    await recordGovernanceHistory(tx, {
      entityType: "certification_dossier",
      entityId: updated.id,
      worksiteId: context.worksiteId,
      changeType: "submitted",
      reason: `Presentado con ${requirements.filter((item) => item.status === "not_met").length} brecha(s); plazo de cierre ${gapsDeadline}`,
      beforeState: context.dossier,
      afterState: updated,
      actorUserId: access.userId,
    })
    return updated
  })
}

const administrativeSchema = z.object({
  dossierId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  adherenceConfirmed: z.boolean(),
  sagecopRegistered: z.boolean(),
  sagecopReference: z.string().trim().max(200).nullable().optional(),
  contributionsStatus: z.string().trim().max(200).nullable().optional(),
  auditedFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  auditedTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

export async function updateDossierAdministrativeData(input: unknown, access: CphsAccess) {
  const data = administrativeSchema.parse(input)

  return db.transaction(async (tx) => {
    const context = await loadDossier(data.dossierId, tx)
    requireCphsAccess(access, "prevention:cphs:certify", context.worksiteId)
    if (context.dossier.status !== "draft") throw new Error("El expediente ya fue presentado: no admite cambios.")
    if (context.dossier.version !== data.expectedVersion) {
      throw new Error("El expediente cambió mientras lo editabas. Recarga y reintenta.")
    }
    if (data.auditedFrom && data.auditedTo && data.auditedTo < data.auditedFrom) {
      throw new Error("El período auditado termina antes de empezar.")
    }

    const [updated] = await tx.update(preventionCertificationDossiers).set({
      adherenceConfirmed: data.adherenceConfirmed,
      sagecopRegistered: data.sagecopRegistered,
      sagecopReference: data.sagecopReference ?? null,
      contributionsStatus: data.contributionsStatus ?? null,
      auditedFrom: data.auditedFrom ?? context.dossier.auditedFrom,
      auditedTo: data.auditedTo ?? context.dossier.auditedTo,
      version: context.dossier.version + 1,
      updatedAt: nowIso(),
    }).where(and(
      eq(preventionCertificationDossiers.id, data.dossierId),
      eq(preventionCertificationDossiers.status, "draft"),
      eq(preventionCertificationDossiers.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("El expediente cambió mientras lo editabas. Recarga y reintenta.")
    return updated
  })
}

const auditResultSchema = z.object({
  dossierId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  outcome: z.enum(["certified", "rejected"]),
  auditedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  auditResult: z.string().trim().min(10).max(2000),
})

/** La certificación de Mutual tiene vigencia anual desde la fecha de auditoría. */
export async function recordAuditResult(input: unknown, access: CphsAccess) {
  const data = auditResultSchema.parse(input)

  return db.transaction(async (tx) => {
    const context = await loadDossier(data.dossierId, tx)
    requireCphsAccess(access, "prevention:cphs:certify", context.worksiteId)
    if (context.dossier.status !== "submitted") {
      throw new Error("Sólo un expediente presentado admite registrar el resultado de la auditoría.")
    }
    if (context.dossier.version !== data.expectedVersion) {
      throw new Error("El expediente cambió mientras lo editabas. Recarga y reintenta.")
    }

    const [updated] = await tx.update(preventionCertificationDossiers).set({
      status: data.outcome,
      auditedOn: data.auditedOn,
      auditResult: data.auditResult,
      validUntilOn: data.outcome === "certified" ? addDays(data.auditedOn, 365) : null,
      version: context.dossier.version + 1,
      updatedAt: nowIso(),
    }).where(and(
      eq(preventionCertificationDossiers.id, data.dossierId),
      eq(preventionCertificationDossiers.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("El expediente cambió mientras lo editabas. Recarga y reintenta.")

    await recordGovernanceHistory(tx, {
      entityType: "certification_dossier",
      entityId: updated.id,
      worksiteId: context.worksiteId,
      changeType: data.outcome,
      reason: data.auditResult,
      beforeState: context.dossier,
      afterState: updated,
      actorUserId: access.userId,
    })
    return updated
  })
}

const reopenSchema = z.object({
  dossierId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(10).max(1000),
})

/**
 * Devuelve a preparación un expediente rechazado. El rechazo de Mutual abre el
 * ciclo de corrección, no lo cierra: sin esto el expediente quedaba en un
 * callejón sin salida y la única salida era crear otro para el mismo período,
 * que el índice único ya impide.
 *
 * Un expediente `certified` NO se reabre: su contenido es la evidencia de lo
 * que se auditó y su vigencia anual depende de ella. Para otro período o nivel
 * se crea un expediente nuevo.
 *
 * Las evaluaciones guardadas se conservan a propósito: las manuales siguen
 * valiendo, lo automático vuelve a evaluarse en vivo mientras el expediente
 * esté en preparación —el congelamiento se rehace al re-presentar— y la CAPA
 * abierta por cada brecha se reutiliza en vez de duplicarse. El resultado de la
 * auditoría tampoco se borra: es la lista de lo que hay que corregir.
 */
export async function reopenCertificationDossier(input: unknown, access: CphsAccess) {
  const data = reopenSchema.parse(input)

  return db.transaction(async (tx) => {
    const context = await loadDossier(data.dossierId, tx)
    requireCphsAccess(access, "prevention:cphs:certify", context.worksiteId)
    if (context.dossier.status === "certified") {
      throw new Error("Un expediente certificado no se reabre: es la evidencia de lo auditado. Crea un expediente nuevo para el período o nivel que corresponda.")
    }
    if (context.dossier.status !== "rejected") {
      throw new Error("Sólo un expediente rechazado vuelve a preparación.")
    }
    if (context.dossier.version !== data.expectedVersion) {
      throw new Error("El expediente cambió mientras lo editabas. Recarga y reintenta.")
    }

    const [updated] = await tx.update(preventionCertificationDossiers).set({
      status: "draft",
      version: context.dossier.version + 1,
      updatedAt: nowIso(),
    }).where(and(
      eq(preventionCertificationDossiers.id, data.dossierId),
      eq(preventionCertificationDossiers.status, "rejected"),
      eq(preventionCertificationDossiers.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("El expediente cambió mientras lo editabas. Recarga y reintenta.")

    await recordGovernanceHistory(tx, {
      entityType: "certification_dossier",
      entityId: updated.id,
      worksiteId: context.worksiteId,
      changeType: "reopened",
      reason: data.reason,
      beforeState: context.dossier,
      afterState: updated,
      actorUserId: access.userId,
    })
    return updated
  })
}

export async function listCertificationDossiers(committeeId: string, access: CphsAccess) {
  const [committee] = await db.select({ worksiteId: preventionCommittees.worksiteId })
    .from(preventionCommittees).where(eq(preventionCommittees.id, committeeId)).limit(1)
  if (!committee) return []
  requireCphsAccess(access, "prevention:cphs:view", committee.worksiteId)

  return db.select().from(preventionCertificationDossiers)
    .where(eq(preventionCertificationDossiers.committeeId, committeeId))
    .orderBy(preventionCertificationDossiers.periodYear)
}
