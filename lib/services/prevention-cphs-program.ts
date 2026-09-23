/**
 * Programa de trabajo del Comité Paritario (D5 del diseño 2026-08-12).
 *
 * Las actividades *del* comité salieron del PDTP porque el CPHS mide su propio
 * cumplimiento; esto es esa medición. La ocurrencia es derivada (ver
 * `lib/prevention/cphs-program.ts`), así que acá no hay slots ni obligaciones
 * que mantener sincronizadas: sólo el plan y lo que se marcó como hecho.
 */

import { and, asc, desc, eq, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import {
  preventionCommitteeMeetings,
  preventionCommitteeMembers,
  preventionCommitteeProgramActivities,
  preventionCommitteePrograms,
  preventionCommittees,
  workers,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import {
  monthLabel,
  summarizeProgramCompliance,
  type ProgramComplianceSummary,
} from "@/lib/prevention/cphs-program"
import {
  CPHS_NOT_FOUND,
  nowIso,
  recordGovernanceHistory,
  requireCphsAccess,
  type CphsAccess,
  type CphsClient,
} from "@/lib/services/prevention-cphs-access"
import { todayInChile } from "@/lib/utils"

const RISK_TOPICS = ["vial", "higiene", "ergonomia", "psicosocial", "silice", "otro"] as const

/** El alcance de un programa lo define la faena de su comité. */
async function loadProgramContext(client: CphsClient, programId: string) {
  const [row] = await client.select({
    program: preventionCommitteePrograms,
    committeeId: preventionCommittees.id,
    worksiteId: preventionCommittees.worksiteId,
    committeeName: preventionCommittees.name,
  })
    .from(preventionCommitteePrograms)
    .innerJoin(preventionCommittees, eq(preventionCommittees.id, preventionCommitteePrograms.committeeId))
    .where(eq(preventionCommitteePrograms.id, programId))
    .limit(1)
  if (!row) throw new Error(CPHS_NOT_FOUND)
  return row
}

/**
 * Contexto de una actividad para **mutarla**. Rechaza las de un programa
 * cerrado acá y no en cada mutación: cerrar el año congela lo ejecutado, y una
 * guarda por llamador es una guarda que el próximo llamador olvida. Los tres
 * usos —completar, cancelar y vincular a sesión— son mutaciones.
 */
async function loadActivityContext(client: CphsClient, activityId: string) {
  const [row] = await client.select({
    activity: preventionCommitteeProgramActivities,
    programId: preventionCommitteePrograms.id,
    programYear: preventionCommitteePrograms.year,
    programStatus: preventionCommitteePrograms.status,
    worksiteId: preventionCommittees.worksiteId,
    committeeId: preventionCommittees.id,
  })
    .from(preventionCommitteeProgramActivities)
    .innerJoin(preventionCommitteePrograms, eq(preventionCommitteePrograms.id, preventionCommitteeProgramActivities.programId))
    .innerJoin(preventionCommittees, eq(preventionCommittees.id, preventionCommitteePrograms.committeeId))
    .where(eq(preventionCommitteeProgramActivities.id, activityId))
    .limit(1)
  if (!row) throw new Error(CPHS_NOT_FOUND)
  if (row.programStatus === "closed") {
    throw new Error("El programa está cerrado: sus actividades ya no admiten cambios.")
  }
  return row
}

/* ── Programa ─────────────────────────────────────────────────────────────── */

const programSchema = z.object({
  committeeId: z.string().min(1),
  year: z.number().int().min(2020).max(2100),
})

export async function createProgram(input: unknown, access: CphsAccess) {
  const data = programSchema.parse(input)

  return db.transaction(async (tx) => {
    const [committee] = await tx.select().from(preventionCommittees)
      .where(eq(preventionCommittees.id, data.committeeId)).limit(1)
    if (!committee) throw new Error(CPHS_NOT_FOUND)
    requireCphsAccess(access, "prevention:cphs:manage", committee.worksiteId)
    if (committee.status !== "active") throw new Error("Sólo un comité vigente puede tener programa de trabajo.")

    const [existing] = await tx.select({ id: preventionCommitteePrograms.id })
      .from(preventionCommitteePrograms)
      .where(and(
        eq(preventionCommitteePrograms.committeeId, data.committeeId),
        eq(preventionCommitteePrograms.year, data.year),
      )).limit(1)
    if (existing) throw new Error(`El comité ya tiene un programa de trabajo para ${data.year}.`)

    const [created] = await tx.insert(preventionCommitteePrograms).values({
      id: `cphspg-${nanoid()}`,
      committeeId: data.committeeId,
      year: data.year,
      createdByUserId: access.userId,
    }).returning()
    if (!created) throw new Error("No se pudo crear el programa de trabajo.")

    await recordGovernanceHistory(tx, {
      entityType: "committee_program",
      entityId: created.id,
      worksiteId: committee.worksiteId,
      changeType: "created",
      reason: `Programa de trabajo ${data.year} del comité`,
      afterState: created,
      actorUserId: access.userId,
    })
    return created
  })
}

const MONTHLY_SESSION_COUNT = 12

/**
 * Las 12 sesiones ordinarias mensuales son la obligación reglamentaria más
 * "casilla" del comité (DS 44/54: 12 sesiones al año), y hoy "no sesionó" es
 * indistinguible de "nadie lo cargó" porque no existe ninguna fila hasta que
 * alguien la crea a mano. D5 prohíbe reusar el motor del PDTP para esto —sin
 * slots ni obligaciones materializadas—, así que se pre-generan **dentro**
 * del programa local del comité: 12 filas normales de
 * `prevention_committee_program_activities`, marcadas con
 * `isMandatorySession` para distinguirlas de una actividad libre.
 *
 * Se llama desde `activateProgram` (no desde `createProgram`): un borrador
 * sigue exigiendo que alguien agregue al menos una actividad para aprobarse
 * —ese gate no cambia—, y recién al aprobarse el programa se vuelve
 * "exigible" (ver el comentario de `activateProgram`), que es cuando
 * corresponde que las 12 sesiones empiecen a contar.
 *
 * El id determinístico (`programId` + mes) + el índice único parcial
 * `..._mandatory_session_unique` + `onConflictDoNothing` hacen la generación
 * idempotente — mismo patrón (no la misma tabla) que
 * `lib/services/prevention-program-slots.ts:42-53`.
 */
async function ensureMonthlySessionActivities(
  client: CphsClient,
  programId: string,
  actorUserId: string,
): Promise<number> {
  const rows = Array.from({ length: MONTHLY_SESSION_COUNT }, (_, index) => {
    const month = index + 1
    return {
      id: `cphspa-session-${programId}-${String(month).padStart(2, "0")}`,
      programId,
      title: `Sesión ordinaria mensual — ${monthLabel(month)}`,
      description: "Sesión ordinaria mensual generada al aprobar el programa (12 sesiones/año exigidas por el DS 54). Se completa sola al cerrar el acta de esa sesión, o puedes cerrarla a mano.",
      plannedMonth: month,
      isMandatorySession: true,
      createdByUserId: actorUserId,
    }
  })
  const created = await client.insert(preventionCommitteeProgramActivities)
    .values(rows)
    .onConflictDoNothing({
      target: [preventionCommitteeProgramActivities.programId, preventionCommitteeProgramActivities.plannedMonth],
      where: sql`${preventionCommitteeProgramActivities.isMandatorySession}`,
    })
    .returning({ id: preventionCommitteeProgramActivities.id })
  return created.length
}

const activateProgramSchema = z.object({
  programId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
})

/**
 * Aprobar el programa lo vuelve exigible. Se exige al menos una actividad: un
 * programa vacío aprobado mide 100% de cumplimiento sobre nada.
 */
export async function activateProgram(input: unknown, access: CphsAccess) {
  const data = activateProgramSchema.parse(input)

  return db.transaction(async (tx) => {
    const context = await loadProgramContext(tx, data.programId)
    requireCphsAccess(access, "prevention:cphs:manage", context.worksiteId)
    if (context.program.status !== "draft") throw new Error("El programa ya salió de preparación.")
    if (context.program.version !== data.expectedVersion) {
      throw new Error("El programa cambió mientras lo editabas. Recarga y reintenta.")
    }

    const activities = await tx.select({ id: preventionCommitteeProgramActivities.id })
      .from(preventionCommitteeProgramActivities)
      .where(eq(preventionCommitteeProgramActivities.programId, data.programId)).limit(1)
    if (activities.length === 0) throw new Error("El programa no tiene actividades: agrega al menos una antes de aprobarlo.")

    const [updated] = await tx.update(preventionCommitteePrograms).set({
      status: "active",
      approvedByUserId: access.userId,
      approvedAt: nowIso(),
      version: context.program.version + 1,
      updatedAt: nowIso(),
    }).where(and(
      eq(preventionCommitteePrograms.id, data.programId),
      eq(preventionCommitteePrograms.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("El programa cambió mientras lo editabas. Recarga y reintenta.")

    // Las 12 sesiones ordinarias del año nacen al aprobarse el programa, no
    // antes: ver el comentario de `ensureMonthlySessionActivities`.
    await ensureMonthlySessionActivities(tx, data.programId, access.userId)

    await recordGovernanceHistory(tx, {
      entityType: "committee_program",
      entityId: updated.id,
      worksiteId: context.worksiteId,
      changeType: "activated",
      reason: `Programa ${context.program.year} aprobado`,
      beforeState: context.program,
      afterState: updated,
      actorUserId: access.userId,
    })
    return updated
  })
}

const closeProgramSchema = z.object({
  programId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
})

/**
 * Cierra el año del programa: es su estado terminal.
 *
 * Sin esto el programa de 2026 seguía "vigente" en 2027 y el job de
 * recordatorios —que mira los programas `active`— reclamaba para siempre las
 * actividades que quedaron sin ejecutar. Cerrar no las borra ni las da por
 * hechas: congela el año con el cumplimiento que alcanzó.
 *
 * Sólo desde `active`. Un borrador nunca aprobado no tiene nada que cerrar, y
 * el CHECK `..._approval_consistent` exige aprobador en todo estado que no sea
 * `draft`.
 */
export async function closeProgram(input: unknown, access: CphsAccess) {
  const data = closeProgramSchema.parse(input)

  return db.transaction(async (tx) => {
    const context = await loadProgramContext(tx, data.programId)
    requireCphsAccess(access, "prevention:cphs:manage", context.worksiteId)
    if (context.program.status !== "active") {
      throw new Error("Sólo un programa vigente puede cerrarse.")
    }
    if (context.program.version !== data.expectedVersion) {
      throw new Error("El programa cambió mientras lo editabas. Recarga y reintenta.")
    }

    const [updated] = await tx.update(preventionCommitteePrograms).set({
      status: "closed",
      version: context.program.version + 1,
      updatedAt: nowIso(),
    }).where(and(
      eq(preventionCommitteePrograms.id, data.programId),
      eq(preventionCommitteePrograms.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("El programa cambió mientras lo editabas. Recarga y reintenta.")

    await recordGovernanceHistory(tx, {
      entityType: "committee_program",
      entityId: updated.id,
      worksiteId: context.worksiteId,
      changeType: "closed",
      reason: `Programa ${context.program.year} cerrado`,
      beforeState: context.program,
      afterState: updated,
      actorUserId: access.userId,
    })
    return updated
  })
}

/* ── Actividades ──────────────────────────────────────────────────────────── */

const activitySchema = z.object({
  programId: z.string().min(1),
  title: z.string().trim().min(5).max(300),
  description: z.string().trim().max(5000).nullable().optional(),
  plannedMonth: z.number().int().min(1).max(12),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  responsibleMemberId: z.string().min(1).nullable().optional(),
  commissionLabel: z.string().trim().max(200).nullable().optional(),
  riskTopic: z.enum(RISK_TOPICS).nullable().optional(),
})

export async function addProgramActivity(input: unknown, access: CphsAccess) {
  const data = activitySchema.parse(input)

  return db.transaction(async (tx) => {
    const context = await loadProgramContext(tx, data.programId)
    requireCphsAccess(access, "prevention:cphs:manage", context.worksiteId)
    if (context.program.status === "closed") throw new Error("El programa está cerrado: no admite actividades nuevas.")

    if (data.responsibleMemberId) {
      const [member] = await tx.select({ id: preventionCommitteeMembers.id })
        .from(preventionCommitteeMembers)
        .where(and(
          eq(preventionCommitteeMembers.id, data.responsibleMemberId),
          eq(preventionCommitteeMembers.committeeId, context.committeeId),
          eq(preventionCommitteeMembers.status, "active"),
        )).limit(1)
      if (!member) throw new Error("El responsable debe ser un integrante activo del comité.")
    }

    const [created] = await tx.insert(preventionCommitteeProgramActivities).values({
      id: `cphspa-${nanoid()}`,
      programId: data.programId,
      title: data.title,
      description: data.description ?? null,
      plannedMonth: data.plannedMonth,
      dueOn: data.dueOn ?? null,
      responsibleMemberId: data.responsibleMemberId ?? null,
      commissionLabel: data.commissionLabel ?? null,
      riskTopic: data.riskTopic ?? null,
      createdByUserId: access.userId,
    }).returning()
    if (!created) throw new Error("No se pudo agregar la actividad.")

    await recordGovernanceHistory(tx, {
      entityType: "program_activity",
      entityId: created.id,
      worksiteId: context.worksiteId,
      changeType: "created",
      reason: `Actividad planificada para ${data.plannedMonth}/${context.program.year}`,
      afterState: created,
      actorUserId: access.userId,
    })
    return created
  })
}

const completeActivitySchema = z.object({
  activityId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  completionNote: z.string().trim().min(10).max(5000),
  evidenceReference: z.string().trim().max(500).nullable().optional(),
  evidenceChecksumSha256: z.string().regex(/^[a-f0-9]{64}$/i).nullable().optional(),
  reviewedInMeetingId: z.string().min(1).nullable().optional(),
})

/**
 * Núcleo de `completeProgramActivity`, parametrizado por cliente para que
 * `closeCommitteeMeeting` (`lib/services/prevention-cphs.ts`) pueda completar
 * la sesión del mes **dentro de su propia transacción** de cierre de acta —
 * mismo patrón que `createCapaActionWithClient` en `prevention-capa.ts`. La
 * versión pública de abajo sólo abre su propia transacción y delega acá.
 */
export async function completeProgramActivityWithClient(
  client: CphsClient,
  input: unknown,
  access: CphsAccess,
) {
  const data = completeActivitySchema.parse(input)

  const context = await loadActivityContext(client, data.activityId)
  requireCphsAccess(access, "prevention:cphs:manage", context.worksiteId)
  if (context.activity.status !== "planned") throw new Error("La actividad ya fue cerrada.")
  if (context.activity.version !== data.expectedVersion) {
    throw new Error("La actividad cambió mientras la editabas. Recarga y reintenta.")
  }
  if (data.reviewedInMeetingId) {
    await assertMeetingBelongsToCommittee(client, data.reviewedInMeetingId, context.committeeId)
  }

  const [updated] = await client.update(preventionCommitteeProgramActivities).set({
    status: "done",
    completedAt: nowIso(),
    completionNote: data.completionNote,
    evidenceReference: data.evidenceReference ?? null,
    evidenceChecksumSha256: data.evidenceChecksumSha256 ?? null,
    reviewedInMeetingId: data.reviewedInMeetingId ?? context.activity.reviewedInMeetingId,
    version: context.activity.version + 1,
    updatedAt: nowIso(),
  }).where(and(
    eq(preventionCommitteeProgramActivities.id, data.activityId),
    eq(preventionCommitteeProgramActivities.version, data.expectedVersion),
  )).returning()
  if (!updated) throw new Error("La actividad cambió mientras la editabas. Recarga y reintenta.")

  await recordGovernanceHistory(client, {
    entityType: "program_activity",
    entityId: updated.id,
    worksiteId: context.worksiteId,
    changeType: "completed",
    reason: data.completionNote,
    beforeState: context.activity,
    afterState: updated,
    actorUserId: access.userId,
  })
  return updated
}

export async function completeProgramActivity(input: unknown, access: CphsAccess) {
  return db.transaction((tx) => completeProgramActivityWithClient(tx, input, access))
}

const cancelActivitySchema = z.object({
  activityId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(10).max(5000),
})

export async function cancelProgramActivity(input: unknown, access: CphsAccess) {
  const data = cancelActivitySchema.parse(input)

  return db.transaction(async (tx) => {
    const context = await loadActivityContext(tx, data.activityId)
    requireCphsAccess(access, "prevention:cphs:manage", context.worksiteId)
    if (context.activity.status !== "planned") throw new Error("La actividad ya fue cerrada.")
    if (context.activity.version !== data.expectedVersion) {
      throw new Error("La actividad cambió mientras la editabas. Recarga y reintenta.")
    }

    const [updated] = await tx.update(preventionCommitteeProgramActivities).set({
      status: "cancelled",
      completionNote: data.reason,
      version: context.activity.version + 1,
      updatedAt: nowIso(),
    }).where(and(
      eq(preventionCommitteeProgramActivities.id, data.activityId),
      eq(preventionCommitteeProgramActivities.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("La actividad cambió mientras la editabas. Recarga y reintenta.")

    await recordGovernanceHistory(tx, {
      entityType: "program_activity",
      entityId: updated.id,
      worksiteId: context.worksiteId,
      changeType: "cancelled",
      reason: data.reason,
      beforeState: context.activity,
      afterState: updated,
      actorUserId: access.userId,
    })
    return updated
  })
}

const linkMeetingSchema = z.object({
  activityId: z.string().min(1),
  meetingId: z.string().min(1),
})

/** "Seguimiento en la reunión mensual": deja constancia de qué sesión la revisó. */
export async function linkActivityToMeeting(input: unknown, access: CphsAccess) {
  const data = linkMeetingSchema.parse(input)

  return db.transaction(async (tx) => {
    const context = await loadActivityContext(tx, data.activityId)
    requireCphsAccess(access, "prevention:cphs:manage", context.worksiteId)
    await assertMeetingBelongsToCommittee(tx, data.meetingId, context.committeeId)

    const [updated] = await tx.update(preventionCommitteeProgramActivities).set({
      reviewedInMeetingId: data.meetingId,
      updatedAt: nowIso(),
    }).where(eq(preventionCommitteeProgramActivities.id, data.activityId)).returning()
    if (!updated) throw new Error(CPHS_NOT_FOUND)

    await recordGovernanceHistory(tx, {
      entityType: "program_activity",
      entityId: updated.id,
      worksiteId: context.worksiteId,
      changeType: "reviewed",
      reason: "Actividad revisada en sesión del comité",
      beforeState: context.activity,
      afterState: updated,
      actorUserId: access.userId,
    })
    return updated
  })
}

async function assertMeetingBelongsToCommittee(client: CphsClient, meetingId: string, committeeId: string) {
  const [meeting] = await client.select({ id: preventionCommitteeMeetings.id })
    .from(preventionCommitteeMeetings)
    .where(and(
      eq(preventionCommitteeMeetings.id, meetingId),
      eq(preventionCommitteeMeetings.committeeId, committeeId),
    )).limit(1)
  if (!meeting) throw new Error("La sesión indicada no pertenece a este comité.")
}

/* ── Lecturas ─────────────────────────────────────────────────────────────── */

export interface ProgramStatus {
  program: typeof preventionCommitteePrograms.$inferSelect
  committeeName: string
  worksiteId: string
  activities: Array<typeof preventionCommitteeProgramActivities.$inferSelect & {
    responsibleName: string | null
  }>
  summary: ProgramComplianceSummary
  asOf: string
}

export async function getProgramStatus(programId: string, access: CphsAccess): Promise<ProgramStatus | null> {
  requireCphsAccess(access, "prevention:cphs:view")
  const context = await loadProgramContext(db, programId).catch(() => null)
  if (!context) return null
  requireCphsAccess(access, "prevention:cphs:view", context.worksiteId)

  const rows = await db.select({
    activity: preventionCommitteeProgramActivities,
    firstName: workers.firstName,
    lastName: workers.lastName,
  })
    .from(preventionCommitteeProgramActivities)
    .leftJoin(preventionCommitteeMembers, eq(preventionCommitteeMembers.id, preventionCommitteeProgramActivities.responsibleMemberId))
    .leftJoin(workers, eq(workers.id, preventionCommitteeMembers.workerId))
    .where(eq(preventionCommitteeProgramActivities.programId, programId))
    .orderBy(asc(preventionCommitteeProgramActivities.plannedMonth), asc(preventionCommitteeProgramActivities.createdAt))

  const asOf = todayInChile()
  const activities = rows.map((row) => ({
    ...row.activity,
    responsibleName: row.lastName && row.firstName ? `${row.lastName}, ${row.firstName}` : null,
  }))

  return {
    program: context.program,
    committeeName: context.committeeName,
    worksiteId: context.worksiteId,
    activities,
    summary: summarizeProgramCompliance(activities, context.program.year, asOf),
    asOf,
  }
}

export async function listProgramsForCommittee(committeeId: string, access: CphsAccess) {
  requireCphsAccess(access, "prevention:cphs:view")
  const [committee] = await db.select({ worksiteId: preventionCommittees.worksiteId })
    .from(preventionCommittees).where(eq(preventionCommittees.id, committeeId)).limit(1)
  if (!committee) return []
  requireCphsAccess(access, "prevention:cphs:view", committee.worksiteId)

  return db.select().from(preventionCommitteePrograms)
    .where(eq(preventionCommitteePrograms.committeeId, committeeId))
    .orderBy(desc(preventionCommitteePrograms.year))
}
