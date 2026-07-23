import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { db, type DB, type Tx } from "@/db"
import {
  preventionCommitteeAgreements,
  preventionCommitteeAttendance,
  preventionCommitteeMeetings,
  preventionCommitteeMembers,
  preventionCommittees,
  preventionGovernanceHistory,
  preventionManagementReviews,
  users,
  workers,
  worksites,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import {
  assessCommitteeParity,
  assessMeetingCadence,
  assessQuorum,
  isMandateExpired,
} from "@/lib/prevention/cphs"
import { createCapaActionWithClient } from "@/lib/services/prevention-capa"
import { getUserIdsWithPermission } from "@/lib/services/notification-targeting"
import { onCphsMeetingClosed, onManagementReviewClosed } from "@/lib/services/pdtp-adapters/pdtp-accreditation-connectors"

type Client = DB | Tx

export interface CphsAccess {
  userId: string
  scope: WorksiteScope
  permissions: readonly string[]
}

const NOT_FOUND = "Registro de comité no encontrado o fuera de alcance."

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

function requireAccess(access: CphsAccess, permission: string, worksiteId?: string) {
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
  await client.insert(preventionGovernanceHistory).values({
    id: `pgovh-${nanoid()}`,
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

/* ── Comité ───────────────────────────────────────────────────────────────── */

const committeeSchema = z.object({
  worksiteId: z.string().min(1),
  name: z.string().trim().min(3).max(200),
  constitutedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mandateEndsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meetingDayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.mandateEndsOn <= value.constitutedOn) {
    ctx.addIssue({ code: "custom", path: ["mandateEndsOn"], message: "El término del mandato debe ser posterior a la constitución." })
  }
})

export async function constituteCommittee(input: unknown, access: CphsAccess) {
  const data = committeeSchema.parse(input)
  requireAccess(access, "prevention:cphs:manage", data.worksiteId)

  const [created] = await db.insert(preventionCommittees).values({
    id: `cphs-${nanoid()}`,
    worksiteId: data.worksiteId,
    name: data.name,
    constitutedOn: data.constitutedOn,
    mandateEndsOn: data.mandateEndsOn,
    meetingDayOfMonth: data.meetingDayOfMonth ?? null,
    createdByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo constituir el comité.")
  await history(db, { entityType: "committee", entityId: created.id, worksiteId: data.worksiteId, changeType: "constituted", reason: `Comité constituido con mandato hasta ${data.mandateEndsOn}`, afterState: created, actorUserId: access.userId })
  return created
}

const memberSchema = z.object({
  committeeId: z.string().min(1),
  workerId: z.string().min(1),
  representation: z.enum(["company", "workers"]),
  seat: z.enum(["titular", "suplente"]),
  role: z.enum(["presidente", "secretario", "integrante"]).nullable().optional(),
  electedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  termEndsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  hasFuero: z.boolean().default(false),
})

export async function addCommitteeMember(input: unknown, access: CphsAccess) {
  const data = memberSchema.parse(input)
  return db.transaction(async (tx) => {
    const [committee] = await tx.select().from(preventionCommittees)
      .where(eq(preventionCommittees.id, data.committeeId)).limit(1)
    if (!committee) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:cphs:manage", committee.worksiteId)
    if (committee.status !== "active") throw new Error("Un comité disuelto o vencido no admite integrantes nuevos.")

    const [worker] = await tx.select().from(workers).where(eq(workers.id, data.workerId)).limit(1)
    if (!worker || !worker.isActive) throw new Error("La persona no existe o está inactiva.")
    if (worker.worksiteId !== committee.worksiteId) {
      throw new Error("El comité representa a un centro de trabajo: no admite integrantes de otra faena.")
    }

    const [created] = await tx.insert(preventionCommitteeMembers).values({
      id: `cphsm-${nanoid()}`,
      committeeId: data.committeeId,
      workerId: data.workerId,
      representation: data.representation,
      seat: data.seat,
      role: data.role ?? "integrante",
      electedOn: data.electedOn ?? null,
      termEndsOn: data.termEndsOn ?? null,
      hasFuero: data.hasFuero,
    }).returning()
    if (!created) throw new Error("No se pudo incorporar al integrante.")
    await history(tx, { entityType: "member", entityId: created.id, worksiteId: committee.worksiteId, changeType: "added", reason: `${data.representation} · ${data.seat}`, afterState: created, actorUserId: access.userId })
    return created
  })
}

/** Estado de validez del comité: paridad, cargos, mandato, cadencia e integrantes. */
export async function getCommitteeStatus(committeeId: string, access: CphsAccess) {
  requireAccess(access, "prevention:cphs:view")
  const [row] = await db.select({ committee: preventionCommittees, worksiteName: worksites.name })
    .from(preventionCommittees)
    .innerJoin(worksites, eq(preventionCommittees.worksiteId, worksites.id))
    .where(eq(preventionCommittees.id, committeeId)).limit(1)
  if (!row || !scopeAllows(access.scope, row.committee.worksiteId)) return null

  const [memberRows, lastClosed] = await Promise.all([
    db.select({
      member: preventionCommitteeMembers,
      workerFirstName: workers.firstName,
      workerLastName: workers.lastName,
    })
      .from(preventionCommitteeMembers)
      .innerJoin(workers, eq(preventionCommitteeMembers.workerId, workers.id))
      .where(eq(preventionCommitteeMembers.committeeId, committeeId))
      .orderBy(asc(workers.lastName)),
    db.select({ heldAt: preventionCommitteeMeetings.heldAt })
      .from(preventionCommitteeMeetings)
      .where(and(
        eq(preventionCommitteeMeetings.committeeId, committeeId),
        eq(preventionCommitteeMeetings.status, "closed"),
      ))
      .orderBy(desc(preventionCommitteeMeetings.heldAt)).limit(1),
  ])

  const members = memberRows.map((item) => ({ ...item.member, workerName: `${item.workerLastName}, ${item.workerFirstName}` }))

  return {
    committee: row.committee,
    worksiteName: row.worksiteName,
    members,
    parity: assessCommitteeParity(members.map((member) => ({
      id: member.id,
      representation: member.representation,
      seat: member.seat,
      role: member.role,
      status: member.status,
    }))),
    mandateExpired: isMandateExpired(row.committee.mandateEndsOn, todayInChile()),
    cadence: assessMeetingCadence(lastClosed[0]?.heldAt ?? null, nowIso()),
    memberCount: members.filter((member) => member.status === "active").length,
  }
}

/* ── Sesiones ─────────────────────────────────────────────────────────────── */

const meetingSchema = z.object({
  committeeId: z.string().min(1),
  meetingType: z.enum(["ordinary", "extraordinary"]).default("ordinary"),
  scheduledFor: z.string().datetime({ offset: true }),
  agenda: z.string().trim().min(10).max(5000),
})

export async function scheduleCommitteeMeeting(input: unknown, access: CphsAccess) {
  const data = meetingSchema.parse(input)
  return db.transaction(async (tx) => {
    const [committee] = await tx.select().from(preventionCommittees)
      .where(eq(preventionCommittees.id, data.committeeId)).limit(1)
    if (!committee) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:cphs:manage", committee.worksiteId)
    if (committee.status !== "active") throw new Error("Un comité disuelto o vencido no puede convocar sesiones.")

    const id = `cphsmt-${nanoid()}`
    const [created] = await tx.insert(preventionCommitteeMeetings).values({
      id,
      code: `CPHS-${new Date().getUTCFullYear()}-${nanoid(8).toUpperCase()}`,
      committeeId: data.committeeId,
      meetingType: data.meetingType,
      scheduledFor: data.scheduledFor,
      agenda: data.agenda,
      createdByUserId: access.userId,
    }).returning()
    if (!created) throw new Error("No se pudo convocar la sesión.")

    // Se convoca a todos los integrantes activos; la asistencia se marca al cerrar.
    const members = await tx.select({ id: preventionCommitteeMembers.id })
      .from(preventionCommitteeMembers)
      .where(and(
        eq(preventionCommitteeMembers.committeeId, data.committeeId),
        eq(preventionCommitteeMembers.status, "active"),
      ))
    if (members.length > 0) {
      await tx.insert(preventionCommitteeAttendance).values(members.map((member) => ({
        id: `cphsa-${nanoid()}`,
        meetingId: id,
        memberId: member.id,
      })))
    }

    await history(tx, { entityType: "meeting", entityId: id, worksiteId: committee.worksiteId, changeType: "scheduled", reason: data.agenda.slice(0, 200), afterState: created, actorUserId: access.userId })
    return created
  })
}

const closeMeetingSchema = z.object({
  meetingId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  heldAt: z.string().datetime({ offset: true }),
  minutes: z.string().trim().min(20).max(20_000),
  attendedMemberIds: z.array(z.string().min(1)).default([]),
  excuses: z.array(z.object({ memberId: z.string().min(1), reason: z.string().trim().min(5).max(1000) })).default([]),
  agreements: z.array(z.object({
    description: z.string().trim().min(5).max(3000),
    actionDescription: z.string().trim().min(3).max(3000),
    responsibleUserId: z.string().min(1).nullable().optional(),
    priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })).default([]),
})

/**
 * Cierra el acta. Exige quórum real: sin él la sesión no produce acuerdos
 * válidos, así que el cierre se rechaza en vez de registrar una reunión que
 * el DS 44 no reconocería. Cada acuerdo se deriva a CAPA común.
 */
export async function closeCommitteeMeeting(input: unknown, access: CphsAccess) {
  const data = closeMeetingSchema.parse(input)
  let accreditation: Parameters<typeof onCphsMeetingClosed>[0] | null = null
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.select({ meeting: preventionCommitteeMeetings, committee: preventionCommittees })
      .from(preventionCommitteeMeetings)
      .innerJoin(preventionCommittees, eq(preventionCommitteeMeetings.committeeId, preventionCommittees.id))
      .where(eq(preventionCommitteeMeetings.id, data.meetingId)).limit(1)
    if (!row) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:cphs:manage", row.committee.worksiteId)
    if (row.meeting.version !== data.expectedVersion) throw new Error("La sesión cambió mientras la editabas. Recarga y reintenta.")
    if (row.meeting.status === "closed") throw new Error("El acta de esta sesión ya fue cerrada.")
    if (row.meeting.status === "cancelled") throw new Error("Una sesión cancelada no puede cerrarse.")

    const members = await tx.select().from(preventionCommitteeMembers)
      .where(eq(preventionCommitteeMembers.committeeId, row.committee.id))
    const quorum = assessQuorum({
      members: members.map((member) => ({
        id: member.id,
        representation: member.representation,
        seat: member.seat,
        role: member.role,
        status: member.status,
      })),
      attendedMemberIds: data.attendedMemberIds,
    })
    if (!quorum.reached) {
      throw new Error(`La sesión no alcanzó quórum: ${quorum.effective} de ${quorum.required} requeridos. No puede cerrarse como sesión válida.`)
    }

    const now = nowIso()
    if (data.attendedMemberIds.length > 0) {
      await tx.update(preventionCommitteeAttendance).set({ attended: true })
        .where(and(
          eq(preventionCommitteeAttendance.meetingId, row.meeting.id),
          inArray(preventionCommitteeAttendance.memberId, data.attendedMemberIds),
        ))
    }
    for (const excuse of data.excuses) {
      await tx.update(preventionCommitteeAttendance).set({ excuseReason: excuse.reason })
        .where(and(
          eq(preventionCommitteeAttendance.meetingId, row.meeting.id),
          eq(preventionCommitteeAttendance.memberId, excuse.memberId),
        ))
    }

    for (const agreement of data.agreements) {
      const capa = await createCapaActionWithClient(tx, {
        sourceType: "cphs",
        sourceId: row.meeting.id,
        worksiteId: row.committee.worksiteId,
        finding: agreement.description,
        actionDescription: agreement.actionDescription,
        responsibleUserId: agreement.responsibleUserId ?? null,
        priority: agreement.priority,
        targetDate: agreement.targetDate,
        evidenceRequired: true,
      }, access.userId)
      await tx.insert(preventionCommitteeAgreements).values({
        id: `cphsag-${nanoid()}`,
        meetingId: row.meeting.id,
        description: agreement.description,
        capaActionId: capa.id,
        status: "capa_linked",
      })
    }

    const [updated] = await tx.update(preventionCommitteeMeetings).set({
      status: "closed",
      heldAt: data.heldAt,
      minutes: data.minutes,
      quorumReached: true,
      closedByUserId: access.userId,
      closedAt: now,
      version: row.meeting.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionCommitteeMeetings.id, row.meeting.id),
      eq(preventionCommitteeMeetings.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("La sesión cambió mientras la editabas. Recarga y reintenta.")
    await history(tx, { entityType: "meeting", entityId: row.meeting.id, worksiteId: row.committee.worksiteId, changeType: "closed", reason: `Acta cerrada con ${data.agreements.length} acuerdo(s)`, beforeState: row.meeting, afterState: updated, actorUserId: access.userId })

    // Auto-acreditación PDTP (CPHS 11/12/13/14): se dispara DESPUÉS del commit.
    accreditation = {
      meetingId: row.meeting.id,
      worksiteId: row.committee.worksiteId,
      heldAt: data.heldAt,
    }

    return { meeting: updated, agreementsCreated: data.agreements.length, quorum }
  })

  if (accreditation) await onCphsMeetingClosed(accreditation)

  return result
}

/* ── Revisión por la dirección ────────────────────────────────────────────── */

const managementReviewSchema = z.object({
  worksiteId: z.string().min(1).nullable().optional(),
  periodLabel: z.string().trim().min(4).max(60),
  heldAt: z.string().datetime({ offset: true }),
  inputs: z.record(z.string(), z.unknown()),
})

export async function createManagementReview(input: unknown, access: CphsAccess) {
  const data = managementReviewSchema.parse(input)
  requireAccess(access, "prevention:governance:review", data.worksiteId ?? undefined)

  const [created] = await db.insert(preventionManagementReviews).values({
    id: `mgmtrev-${nanoid()}`,
    code: `RD-${new Date().getUTCFullYear()}-${nanoid(6).toUpperCase()}`,
    worksiteId: data.worksiteId ?? null,
    periodLabel: data.periodLabel,
    heldAt: data.heldAt,
    inputs: data.inputs,
    createdByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo registrar la revisión por la dirección.")
  await history(db, { entityType: "management_review", entityId: created.id, worksiteId: data.worksiteId ?? null, changeType: "created", reason: `Revisión ${data.periodLabel}`, afterState: created, actorUserId: access.userId })
  return created
}

const closeReviewSchema = z.object({
  reviewId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  conclusions: z.string().trim().min(20).max(20_000),
  resourceDecisions: z.string().trim().max(10_000).nullable().optional(),
  commitments: z.array(z.object({
    description: z.string().trim().min(5).max(3000),
    actionDescription: z.string().trim().min(3).max(3000),
    responsibleUserId: z.string().min(1).nullable().optional(),
    worksiteId: z.string().min(1),
    priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })).default([]),
})

/**
 * Cerrar la revisión exige conclusiones: el DS 44 art. 22 pide evaluar el
 * sistema, no sólo dejar constancia de que hubo reunión. Los compromisos con
 * plazo se derivan a CAPA para que tengan seguimiento real.
 */
export async function closeManagementReview(input: unknown, access: CphsAccess) {
  const data = closeReviewSchema.parse(input)
  requireAccess(access, "prevention:governance:review")

  let accreditation: Parameters<typeof onManagementReviewClosed>[0] | null = null
  const result = await db.transaction(async (tx) => {
    const [review] = await tx.select().from(preventionManagementReviews)
      .where(eq(preventionManagementReviews.id, data.reviewId)).limit(1)
    if (!review) throw new Error(NOT_FOUND)
    if (review.version !== data.expectedVersion) throw new Error("La revisión cambió mientras la editabas. Recarga y reintenta.")
    if (review.status === "closed") throw new Error("La revisión ya fue cerrada.")

    for (const commitment of data.commitments) {
      requireAccess(access, "prevention:governance:review", commitment.worksiteId)
      await createCapaActionWithClient(tx, {
        sourceType: "cphs",
        sourceId: review.id,
        worksiteId: commitment.worksiteId,
        finding: commitment.description,
        actionDescription: commitment.actionDescription,
        responsibleUserId: commitment.responsibleUserId ?? null,
        priority: commitment.priority,
        targetDate: commitment.targetDate,
        evidenceRequired: true,
      }, access.userId)
    }

    const now = nowIso()
    const [updated] = await tx.update(preventionManagementReviews).set({
      status: "closed",
      conclusions: data.conclusions,
      resourceDecisions: data.resourceDecisions ?? null,
      closedByUserId: access.userId,
      closedAt: now,
      version: review.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionManagementReviews.id, review.id),
      eq(preventionManagementReviews.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("La revisión cambió mientras la editabas. Recarga y reintenta.")
    await history(tx, { entityType: "management_review", entityId: review.id, worksiteId: review.worksiteId, changeType: "closed", reason: `Cerrada con ${data.commitments.length} compromiso(s)`, beforeState: review, afterState: updated, actorUserId: access.userId })

    // Auto-acreditación PDTP (revisión por la dirección → actividad 14): se
    // dispara DESPUÉS del commit.
    if (review.worksiteId) {
      accreditation = {
        reviewId: review.id,
        worksiteId: review.worksiteId,
        heldAt: review.heldAt,
      }
    }

    return { review: updated, commitmentsCreated: data.commitments.length }
  })

  if (accreditation) await onManagementReviewClosed(accreditation)

  return result
}

/** Marca vencidos los comités cuyo mandato ya pasó. Idempotente. */
export async function expireLapsedCommittees() {
  const today = todayInChile()
  const updated = await db.update(preventionCommittees)
    .set({ status: "expired", updatedAt: nowIso() })
    .where(and(
      eq(preventionCommittees.status, "active"),
      sql`${preventionCommittees.mandateEndsOn} < ${today}`,
    ))
    .returning({ id: preventionCommittees.id })
  return { expired: updated.length }
}

/* ── Consultas ────────────────────────────────────────────────────────────── */

export async function listCommittees(access: CphsAccess) {
  requireAccess(access, "prevention:cphs:view")
  return db.select({
    committee: preventionCommittees,
    worksiteName: worksites.name,
    activeMembers: sql<number>`(SELECT COUNT(*)::int FROM prevention_committee_members m WHERE m.committee_id = ${preventionCommittees.id} AND m.status = 'active')`,
    closedMeetings: sql<number>`(SELECT COUNT(*)::int FROM prevention_committee_meetings t WHERE t.committee_id = ${preventionCommittees.id} AND t.status = 'closed')`,
    lastMeetingAt: sql<string | null>`(SELECT MAX(t.held_at) FROM prevention_committee_meetings t WHERE t.committee_id = ${preventionCommittees.id} AND t.status = 'closed')`,
  })
    .from(preventionCommittees)
    .innerJoin(worksites, eq(preventionCommittees.worksiteId, worksites.id))
    .where(scopeCondition(access.scope, preventionCommittees.worksiteId))
    .orderBy(asc(worksites.name))
}

export async function listCommitteeMeetings(access: CphsAccess) {
  requireAccess(access, "prevention:cphs:view")
  return db.select({
    meeting: preventionCommitteeMeetings,
    committeeName: preventionCommittees.name,
    worksiteId: preventionCommittees.worksiteId,
    worksiteName: worksites.name,
    convened: sql<number>`(SELECT COUNT(*)::int FROM prevention_committee_attendance a WHERE a.meeting_id = ${preventionCommitteeMeetings.id})`,
    attended: sql<number>`(SELECT COUNT(*)::int FROM prevention_committee_attendance a WHERE a.meeting_id = ${preventionCommitteeMeetings.id} AND a.attended = true)`,
    agreements: sql<number>`(SELECT COUNT(*)::int FROM prevention_committee_agreements g WHERE g.meeting_id = ${preventionCommitteeMeetings.id})`,
  })
    .from(preventionCommitteeMeetings)
    .innerJoin(preventionCommittees, eq(preventionCommitteeMeetings.committeeId, preventionCommittees.id))
    .innerJoin(worksites, eq(preventionCommittees.worksiteId, worksites.id))
    .where(scopeCondition(access.scope, preventionCommittees.worksiteId))
    .orderBy(desc(preventionCommitteeMeetings.scheduledFor))
    .limit(300)
}

export async function listManagementReviews(access: CphsAccess) {
  requireAccess(access, "prevention:governance:review")
  return db.select({ review: preventionManagementReviews, worksiteName: worksites.name })
    .from(preventionManagementReviews)
    .leftJoin(worksites, eq(preventionManagementReviews.worksiteId, worksites.id))
    .orderBy(desc(preventionManagementReviews.heldAt))
    .limit(200)
}

/** Faenas visibles para el alcance, para poblar la constitución de comités. */
export async function listCommitteeWorksites(access: CphsAccess) {
  requireAccess(access, "prevention:cphs:view")
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
 * Dotación activa dentro del alcance, para incorporar integrantes.
 *
 * Devuelve `worksiteId` porque el servicio rechaza integrantes de otra faena:
 * el formulario filtra por la faena del comité y así el rechazo no aparece
 * recién al enviar.
 */
export async function listCommitteeWorkers(access: CphsAccess) {
  requireAccess(access, "prevention:cphs:view")
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

/** Candidatos a responsable de un acuerdo o compromiso: quienes gestionan CPHS. */
export async function listCommitteeAssignees(access: CphsAccess) {
  requireAccess(access, "prevention:cphs:view")
  const ids = await getUserIdsWithPermission("prevention:cphs:manage")
  if (ids.length === 0) return []
  return db.select({ id: users.id, name: users.name })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.isActive, true)))
    .orderBy(asc(users.name))
}
