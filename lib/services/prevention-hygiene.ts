import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { z } from "zod"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { db, type DB, type Tx } from "@/db"
import {
  preventionExposureAgents,
  preventionExposureGroupMembers,
  preventionExposureGroups,
  preventionExposureMeasurements,
  preventionHygieneHistory,
  preventionSurveillanceEnrollments,
  preventionSurveillancePrograms,
  workers,
  worksites,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import {
  assessMeasurement,
  deriveSurveillanceObligation,
  nextSurveillanceDate,
  summarizeExposureAnonymized,
} from "@/lib/prevention/hygiene"

type Client = DB | Tx

export interface HygieneAccess {
  userId: string
  scope: WorksiteScope
  permissions: readonly string[]
}

const NOT_FOUND = "Registro de higiene no encontrado o fuera de alcance."

const CHILE_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" })

function todayInChile() {
  return CHILE_DATE_FORMAT.format(new Date())
}

function nowIso() {
  return new Date().toISOString()
}

function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

function requireAccess(access: HygieneAccess, permission: string, worksiteId?: string) {
  if (!access.permissions.includes(permission) || (worksiteId && !scopeAllows(access.scope, worksiteId))) {
    throw new Error(NOT_FOUND)
  }
}

function scopeCondition(scope: WorksiteScope, column: AnyPgColumn) {
  if (scope.mode === "all") return undefined
  if (scope.mode === "none" || scope.ids.length === 0) return sql`false`
  return inArray(column, scope.ids)
}

async function history(client: Client, args: {
  entityType: string
  entityId: string
  worksiteId?: string | null
  changeType: string
  reason: string
  beforeState?: unknown
  afterState?: unknown
  actorUserId?: string | null
}) {
  await client.insert(preventionHygieneHistory).values({
    id: `phygh-${nanoid()}`,
    entityType: args.entityType,
    entityId: args.entityId,
    worksiteId: args.worksiteId ?? null,
    changeType: args.changeType,
    reason: args.reason,
    beforeState: args.beforeState ?? null,
    afterState: args.afterState ?? null,
    actorUserId: args.actorUserId ?? null,
  })
}

/* ── Agentes ──────────────────────────────────────────────────────────────── */

const agentSchema = z.object({
  code: z.string().trim().min(2).max(60),
  name: z.string().trim().min(3).max(200),
  agentType: z.enum(["chemical", "physical", "biological", "ergonomic", "psychosocial"]),
  unit: z.string().trim().min(1).max(40),
  permissibleLimit: z.number().positive().nullable().optional(),
  actionLevelFactor: z.number().positive().max(1).default(0.5),
  limitBasis: z.string().trim().min(5).max(2000),
  surveillanceProtocol: z.string().trim().max(200).nullable().optional(),
})

export async function createExposureAgent(input: unknown, access: HygieneAccess) {
  requireAccess(access, "prevention:hygiene:manage")
  const data = agentSchema.parse(input)
  const [created] = await db.insert(preventionExposureAgents).values({
    id: `expag-${nanoid()}`,
    code: data.code,
    name: data.name,
    agentType: data.agentType,
    unit: data.unit,
    permissibleLimit: data.permissibleLimit == null ? null : String(data.permissibleLimit),
    actionLevelFactor: String(data.actionLevelFactor),
    limitBasis: data.limitBasis,
    surveillanceProtocol: data.surveillanceProtocol ?? null,
    createdByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo registrar el agente.")
  await history(db, { entityType: "agent", entityId: created.id, changeType: "created", reason: data.limitBasis, afterState: created, actorUserId: access.userId })
  return created
}

/* ── Grupos de exposición similar ─────────────────────────────────────────── */

const groupSchema = z.object({
  code: z.string().trim().min(2).max(60),
  name: z.string().trim().min(3).max(200),
  worksiteId: z.string().min(1),
  agentId: z.string().min(1),
  processDescription: z.string().trim().min(10).max(3000),
  riskEntryId: z.string().min(1).nullable().optional(),
})

export async function createExposureGroup(input: unknown, access: HygieneAccess) {
  const data = groupSchema.parse(input)
  requireAccess(access, "prevention:hygiene:manage", data.worksiteId)

  const [agent] = await db.select().from(preventionExposureAgents)
    .where(eq(preventionExposureAgents.id, data.agentId)).limit(1)
  if (!agent || !agent.isActive) throw new Error("El agente de exposición no existe o está inactivo.")

  const [created] = await db.insert(preventionExposureGroups).values({
    id: `expgr-${nanoid()}`,
    code: data.code,
    name: data.name,
    worksiteId: data.worksiteId,
    agentId: data.agentId,
    processDescription: data.processDescription,
    riskEntryId: data.riskEntryId ?? null,
    createdByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo crear el grupo de exposición.")
  await history(db, { entityType: "group", entityId: created.id, worksiteId: data.worksiteId, changeType: "created", reason: `GES para ${agent.name}`, afterState: created, actorUserId: access.userId })
  return created
}

export async function addExposureGroupMember(input: unknown, access: HygieneAccess) {
  const data = z.object({
    groupId: z.string().min(1),
    workerId: z.string().min(1),
    joinedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).parse(input)

  return db.transaction(async (tx) => {
    const [group] = await tx.select().from(preventionExposureGroups)
      .where(eq(preventionExposureGroups.id, data.groupId)).limit(1)
    if (!group) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:hygiene:manage", group.worksiteId)

    const [worker] = await tx.select().from(workers).where(eq(workers.id, data.workerId)).limit(1)
    if (!worker || !worker.isActive) throw new Error("La persona no existe o está inactiva.")
    if (worker.worksiteId !== group.worksiteId) {
      throw new Error("El grupo de exposición pertenece a una faena: no admite personas de otra.")
    }

    const [created] = await tx.insert(preventionExposureGroupMembers).values({
      id: `expgm-${nanoid()}`,
      groupId: data.groupId,
      workerId: data.workerId,
      joinedOn: data.joinedOn,
    }).returning()
    if (!created) throw new Error("No se pudo incorporar a la persona al grupo.")
    return created
  })
}

/* ── Mediciones ───────────────────────────────────────────────────────────── */

const measurementSchema = z.object({
  groupId: z.string().min(1),
  measuredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.number().nonnegative(),
  method: z.string().trim().min(3).max(300),
  laboratoryName: z.string().trim().max(200).nullable().optional(),
  equipmentTag: z.string().trim().min(1).max(200),
  calibrationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  sampleDurationMinutes: z.number().int().positive().max(10_000).nullable().optional(),
  reportReference: z.string().trim().max(2000).nullable().optional(),
})

/**
 * Registra una medición y recalcula la obligación de vigilancia del grupo.
 *
 * El límite y el nivel de acción se congelan en la fila: si el agente cambia
 * su límite después, la evidencia de esta medición sigue diciendo contra qué
 * se comparó.
 */
export async function recordExposureMeasurement(input: unknown, access: HygieneAccess) {
  const data = measurementSchema.parse(input)

  return db.transaction(async (tx) => {
    const [row] = await tx.select({ group: preventionExposureGroups, agent: preventionExposureAgents })
      .from(preventionExposureGroups)
      .innerJoin(preventionExposureAgents, eq(preventionExposureGroups.agentId, preventionExposureAgents.id))
      .where(eq(preventionExposureGroups.id, data.groupId)).limit(1)
    if (!row) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:hygiene:measure", row.group.worksiteId)

    const permissibleLimit = row.agent.permissibleLimit === null ? null : Number(row.agent.permissibleLimit)
    const assessment = assessMeasurement(data.value, {
      permissibleLimit,
      actionLevelFactor: Number(row.agent.actionLevelFactor),
    })

    const [created] = await tx.insert(preventionExposureMeasurements).values({
      id: `expms-${nanoid()}`,
      groupId: data.groupId,
      measuredOn: data.measuredOn,
      value: String(data.value),
      unit: row.agent.unit,
      permissibleLimitSnapshot: permissibleLimit === null ? null : String(permissibleLimit),
      actionLevelSnapshot: assessment.actionLevel === null ? null : String(assessment.actionLevel),
      outcome: assessment.outcome,
      method: data.method,
      laboratoryName: data.laboratoryName ?? null,
      equipmentTag: data.equipmentTag,
      calibrationDate: data.calibrationDate ?? null,
      sampleDurationMinutes: data.sampleDurationMinutes ?? null,
      reportReference: data.reportReference ?? null,
      recordedByUserId: access.userId,
    }).returning()
    if (!created) throw new Error("No se pudo registrar la medición.")

    // La obligación de vigilancia se recalcula con todo el historial, no sólo
    // con la medición recién ingresada.
    const measurements = await tx.select({ measuredOn: preventionExposureMeasurements.measuredOn, outcome: preventionExposureMeasurements.outcome })
      .from(preventionExposureMeasurements)
      .where(eq(preventionExposureMeasurements.groupId, data.groupId))
    const obligation = deriveSurveillanceObligation(measurements)

    const now = nowIso()
    await tx.update(preventionExposureGroups).set({
      surveillanceRequired: obligation.required,
      surveillanceReason: obligation.required ? obligation.basis : null,
      version: row.group.version + 1,
      updatedAt: now,
    }).where(eq(preventionExposureGroups.id, data.groupId))

    await history(tx, {
      entityType: "measurement", entityId: created.id, worksiteId: row.group.worksiteId,
      changeType: assessment.outcome,
      reason: `${data.value} ${row.agent.unit} · ${obligation.basis}`,
      afterState: created, actorUserId: access.userId,
    })
    return { measurement: created, assessment, surveillanceRequired: obligation.required, basis: obligation.basis }
  })
}

/* ── Vigilancia ───────────────────────────────────────────────────────────── */

const programSchema = z.object({
  code: z.string().trim().min(2).max(60),
  name: z.string().trim().min(3).max(200),
  protocol: z.string().trim().min(2).max(120),
  agentId: z.string().min(1).nullable().optional(),
  worksiteId: z.string().min(1),
  periodicityMonths: z.number().int().positive().max(120),
  legalBasis: z.string().trim().min(5).max(2000),
})

export async function createSurveillanceProgram(input: unknown, access: HygieneAccess) {
  const data = programSchema.parse(input)
  requireAccess(access, "prevention:hygiene:manage", data.worksiteId)

  const [created] = await db.insert(preventionSurveillancePrograms).values({
    id: `survpr-${nanoid()}`,
    code: data.code,
    name: data.name,
    protocol: data.protocol,
    agentId: data.agentId ?? null,
    worksiteId: data.worksiteId,
    periodicityMonths: data.periodicityMonths,
    legalBasis: data.legalBasis,
    createdByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo crear el programa de vigilancia.")
  await history(db, { entityType: "program", entityId: created.id, worksiteId: data.worksiteId, changeType: "created", reason: data.legalBasis, afterState: created, actorUserId: access.userId })
  return created
}

/**
 * Matricula al grupo completo en el programa. La nómina se deriva de la
 * pertenencia al GES y no se arma a mano: eso es lo que impide que alguien
 * expuesto quede fuera de la vigilancia por olvido.
 */
export async function enrollGroupInSurveillance(input: unknown, access: HygieneAccess) {
  const data = z.object({
    programId: z.string().min(1),
    groupId: z.string().min(1),
    startingOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).parse(input)

  return db.transaction(async (tx) => {
    const [program] = await tx.select().from(preventionSurveillancePrograms)
      .where(eq(preventionSurveillancePrograms.id, data.programId)).limit(1)
    if (!program) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:hygiene:manage", program.worksiteId)
    if (program.status !== "active") throw new Error("Sólo un programa vigente admite matrículas.")

    const [group] = await tx.select().from(preventionExposureGroups)
      .where(eq(preventionExposureGroups.id, data.groupId)).limit(1)
    if (!group) throw new Error(NOT_FOUND)
    if (group.worksiteId !== program.worksiteId) {
      throw new Error("El grupo y el programa pertenecen a faenas distintas.")
    }

    const members = await tx.select().from(preventionExposureGroupMembers)
      .where(and(
        eq(preventionExposureGroupMembers.groupId, data.groupId),
        isNull(preventionExposureGroupMembers.leftOn),
      ))
    if (members.length === 0) throw new Error("El grupo no tiene personas activas que matricular.")

    const enrolledOn = data.startingOn ?? todayInChile()
    const dueOn = nextSurveillanceDate(enrolledOn, program.periodicityMonths)
    let created = 0
    for (const member of members) {
      const [row] = await tx.insert(preventionSurveillanceEnrollments).values({
        id: `surven-${nanoid()}`,
        programId: data.programId,
        workerId: member.workerId,
        groupId: data.groupId,
        enrolledOn,
        dueOn,
      }).onConflictDoNothing().returning()
      if (row) created += 1
    }

    await history(tx, { entityType: "program", entityId: data.programId, worksiteId: program.worksiteId, changeType: "enrolled", reason: `${created} persona(s) matriculadas desde el GES ${group.code}`, actorUserId: access.userId })
    return { enrolled: created, total: members.length, dueOn }
  })
}

/**
 * Registra el resultado del control. El dato clínico no se guarda aquí: se
 * enlaza al registro de salud cifrado que ya existe en el dominio sensible.
 */
export async function recordSurveillanceOutcome(input: unknown, access: HygieneAccess) {
  const data = z.object({
    enrollmentId: z.string().min(1),
    status: z.enum(["summoned", "attended", "absent", "exempt"]),
    attendedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    healthRecordId: z.string().min(1).nullable().optional(),
    absenceReason: z.string().trim().max(1000).nullable().optional(),
  }).parse(input)

  return db.transaction(async (tx) => {
    const [row] = await tx.select({ enrollment: preventionSurveillanceEnrollments, program: preventionSurveillancePrograms })
      .from(preventionSurveillanceEnrollments)
      .innerJoin(preventionSurveillancePrograms, eq(preventionSurveillanceEnrollments.programId, preventionSurveillancePrograms.id))
      .where(eq(preventionSurveillanceEnrollments.id, data.enrollmentId)).limit(1)
    if (!row) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:hygiene:manage", row.program.worksiteId)

    if (data.status === "attended" && !data.attendedOn) {
      throw new Error("Registrar asistencia exige la fecha del control.")
    }
    if (data.status === "absent" && (data.absenceReason?.trim().length ?? 0) < 5) {
      throw new Error("Registrar una ausencia exige indicar el motivo.")
    }

    const now = nowIso()
    const [updated] = await tx.update(preventionSurveillanceEnrollments).set({
      status: data.status,
      summonedAt: data.status === "summoned" ? now : row.enrollment.summonedAt,
      attendedOn: data.attendedOn ?? row.enrollment.attendedOn,
      healthRecordId: data.healthRecordId ?? row.enrollment.healthRecordId,
      absenceReason: data.status === "absent" ? data.absenceReason ?? null : null,
      updatedAt: now,
    }).where(eq(preventionSurveillanceEnrollments.id, data.enrollmentId)).returning()
    if (!updated) throw new Error("No se pudo registrar el resultado.")
    await history(tx, { entityType: "enrollment", entityId: data.enrollmentId, worksiteId: row.program.worksiteId, changeType: data.status, reason: data.absenceReason ?? `Control ${data.status}`, actorUserId: access.userId })
    return updated
  })
}

/* ── Consultas ────────────────────────────────────────────────────────────── */

export async function listExposureGroups(access: HygieneAccess) {
  requireAccess(access, "prevention:hygiene:view")
  return db.select({
    group: preventionExposureGroups,
    agentName: preventionExposureAgents.name,
    agentType: preventionExposureAgents.agentType,
    agentUnit: preventionExposureAgents.unit,
    worksiteName: worksites.name,
    memberCount: sql<number>`(SELECT COUNT(*)::int FROM prevention_exposure_group_members m WHERE m.group_id = ${preventionExposureGroups.id} AND m.left_on IS NULL)`,
    measurementCount: sql<number>`(SELECT COUNT(*)::int FROM prevention_exposure_measurements x WHERE x.group_id = ${preventionExposureGroups.id})`,
    latestOutcome: sql<string | null>`(SELECT x.outcome FROM prevention_exposure_measurements x WHERE x.group_id = ${preventionExposureGroups.id} ORDER BY x.measured_on DESC LIMIT 1)`,
  })
    .from(preventionExposureGroups)
    .innerJoin(preventionExposureAgents, eq(preventionExposureGroups.agentId, preventionExposureAgents.id))
    .innerJoin(worksites, eq(preventionExposureGroups.worksiteId, worksites.id))
    .where(scopeCondition(access.scope, preventionExposureGroups.worksiteId))
    .orderBy(asc(preventionExposureGroups.code))
}

/**
 * Panel anonimizado de exposición y cobertura de vigilancia. Nunca devuelve
 * personas: es la vista que puede compartirse con jefatura y con el CPHS.
 */
export async function getAnonymizedExposureSummary(access: HygieneAccess) {
  requireAccess(access, "prevention:hygiene:view")
  const rows = await db.select({
    groupId: preventionExposureGroups.id,
    groupName: preventionExposureGroups.name,
    agentName: preventionExposureAgents.name,
    exposedCount: sql<number>`(SELECT COUNT(*)::int FROM prevention_exposure_group_members m WHERE m.group_id = ${preventionExposureGroups.id} AND m.left_on IS NULL)`,
    attendedCount: sql<number>`(SELECT COUNT(*)::int FROM prevention_surveillance_enrollments e WHERE e.group_id = ${preventionExposureGroups.id} AND e.status = 'attended')`,
    latestOutcome: sql<string | null>`(SELECT x.outcome FROM prevention_exposure_measurements x WHERE x.group_id = ${preventionExposureGroups.id} ORDER BY x.measured_on DESC LIMIT 1)`,
  })
    .from(preventionExposureGroups)
    .innerJoin(preventionExposureAgents, eq(preventionExposureGroups.agentId, preventionExposureAgents.id))
    .where(and(
      eq(preventionExposureGroups.isActive, true),
      scopeCondition(access.scope, preventionExposureGroups.worksiteId),
    ))
  return summarizeExposureAnonymized(rows)
}

export async function listSurveillancePrograms(access: HygieneAccess) {
  requireAccess(access, "prevention:hygiene:view")
  return db.select({
    program: preventionSurveillancePrograms,
    worksiteName: worksites.name,
    agentName: preventionExposureAgents.name,
    enrolled: sql<number>`(SELECT COUNT(*)::int FROM prevention_surveillance_enrollments e WHERE e.program_id = ${preventionSurveillancePrograms.id})`,
    attended: sql<number>`(SELECT COUNT(*)::int FROM prevention_surveillance_enrollments e WHERE e.program_id = ${preventionSurveillancePrograms.id} AND e.status = 'attended')`,
    overdue: sql<number>`(SELECT COUNT(*)::int FROM prevention_surveillance_enrollments e WHERE e.program_id = ${preventionSurveillancePrograms.id} AND e.status IN ('pending','summoned') AND e.due_on < ${todayInChile()})`,
  })
    .from(preventionSurveillancePrograms)
    .innerJoin(worksites, eq(preventionSurveillancePrograms.worksiteId, worksites.id))
    .leftJoin(preventionExposureAgents, eq(preventionSurveillancePrograms.agentId, preventionExposureAgents.id))
    .where(scopeCondition(access.scope, preventionSurveillancePrograms.worksiteId))
    .orderBy(asc(preventionSurveillancePrograms.code))
}

export async function listExposureAgents(access: HygieneAccess) {
  requireAccess(access, "prevention:hygiene:view")
  return db.select().from(preventionExposureAgents).orderBy(asc(preventionExposureAgents.code))
}

export async function listGroupMeasurements(groupId: string, access: HygieneAccess) {
  requireAccess(access, "prevention:hygiene:view")
  const [row] = await db.select({ group: preventionExposureGroups, agent: preventionExposureAgents, worksiteName: worksites.name })
    .from(preventionExposureGroups)
    .innerJoin(preventionExposureAgents, eq(preventionExposureGroups.agentId, preventionExposureAgents.id))
    .innerJoin(worksites, eq(preventionExposureGroups.worksiteId, worksites.id))
    .where(eq(preventionExposureGroups.id, groupId)).limit(1)
  if (!row || !scopeAllows(access.scope, row.group.worksiteId)) return null

  const [measurements, memberRows] = await Promise.all([
    db.select().from(preventionExposureMeasurements)
      .where(eq(preventionExposureMeasurements.groupId, groupId))
      .orderBy(desc(preventionExposureMeasurements.measuredOn)),
    db.select({
      member: preventionExposureGroupMembers,
      workerFirstName: workers.firstName,
      workerLastName: workers.lastName,
      workerPosition: workers.position,
    })
      .from(preventionExposureGroupMembers)
      .innerJoin(workers, eq(preventionExposureGroupMembers.workerId, workers.id))
      .where(eq(preventionExposureGroupMembers.groupId, groupId))
      .orderBy(asc(workers.lastName)),
  ])

  const members = memberRows.map((item) => ({
    ...item.member,
    workerName: `${item.workerLastName}, ${item.workerFirstName}`,
    workerPosition: item.workerPosition,
  }))

  return { group: row.group, agent: row.agent, worksiteName: row.worksiteName, measurements, members }
}

/** Faenas visibles para el alcance, para poblar la creación de GES y programas. */
export async function listHygieneWorksites(access: HygieneAccess) {
  requireAccess(access, "prevention:hygiene:view")
  if (access.scope.mode === "none") return []
  return db.select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(and(
      eq(worksites.isActive, true),
      access.scope.mode === "some" ? inArray(worksites.id, access.scope.ids) : undefined,
    ))
    .orderBy(asc(worksites.name))
}

/**
 * Dotación activa dentro del alcance, para incorporar integrantes a un GES.
 *
 * Devuelve `worksiteId` porque el servicio rechaza personas de otra faena: el
 * formulario filtra por la faena del grupo y así el rechazo no aparece recién
 * al enviar.
 */
export async function listHygieneWorkers(access: HygieneAccess) {
  requireAccess(access, "prevention:hygiene:view")
  if (access.scope.mode === "none") return []
  return db.select({
    id: workers.id,
    firstName: workers.firstName,
    lastName: workers.lastName,
    position: workers.position,
    worksiteId: workers.worksiteId,
  })
    .from(workers)
    .where(and(
      eq(workers.isActive, true),
      access.scope.mode === "some" ? inArray(workers.worksiteId, access.scope.ids) : undefined,
    ))
    .orderBy(asc(workers.lastName), asc(workers.firstName))
    .limit(2000)
}

/** Matrículas de un programa, con la persona y el GES de origen. */
export async function listProgramEnrollments(programId: string, access: HygieneAccess) {
  requireAccess(access, "prevention:hygiene:view")
  const [program] = await db.select().from(preventionSurveillancePrograms)
    .where(eq(preventionSurveillancePrograms.id, programId)).limit(1)
  if (!program || !scopeAllows(access.scope, program.worksiteId)) return null

  const enrollments = await db.select({
    enrollment: preventionSurveillanceEnrollments,
    workerFirstName: workers.firstName,
    workerLastName: workers.lastName,
    groupName: preventionExposureGroups.name,
  })
    .from(preventionSurveillanceEnrollments)
    .innerJoin(workers, eq(preventionSurveillanceEnrollments.workerId, workers.id))
    .leftJoin(preventionExposureGroups, eq(preventionSurveillanceEnrollments.groupId, preventionExposureGroups.id))
    .where(eq(preventionSurveillanceEnrollments.programId, programId))
    .orderBy(asc(preventionSurveillanceEnrollments.dueOn))

  return {
    program,
    enrollments: enrollments.map((item) => ({
      ...item.enrollment,
      workerName: `${item.workerLastName}, ${item.workerFirstName}`,
      groupName: item.groupName,
    })),
  }
}
