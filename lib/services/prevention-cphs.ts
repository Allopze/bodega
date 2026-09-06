import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import {
  preventionCommitteeAgreements,
  preventionCommitteeAttendance,
  preventionCommitteeCommissionMembers,
  preventionCommitteeCommissions,
  preventionCommitteeMeetings,
  preventionCommitteeMembers,
  preventionCommittees,
  preventionManagementReviews,
  users,
  workers,
  worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import {
  CPHS_NOT_FOUND,
  cphsScopeCondition,
  nowIso,
  recordGovernanceHistory,
  requireCphsAccess,
  scopeAllows,
  type CphsAccess,
  type CphsClient,
} from "@/lib/services/prevention-cphs-access"
import {
  assessCommitteeParity,
  assessMeetingCadence,
  assessQuorum,
  isMandateExpired,
  REPRESENTATION_LABELS,
} from "@/lib/prevention/cphs"
import { createCapaActionWithClient } from "@/lib/services/prevention-capa"
import { getUserIdsWithPermission } from "@/lib/services/notification-targeting"
import { onCphsCommitteeConstituted, onManagementReviewClosed } from "@/lib/services/pdtp-adapters/pdtp-accreditation-connectors"
import { onPreventiveOrganizationSatisfied } from "@/lib/services/pdtp-adapters/preventive-organization-connector"
import { recordPdtpFulfillmentRevocation } from "@/lib/services/pdtp/fulfillment"
import { codeYear, todayInChile } from "@/lib/utils"

const NOT_FOUND = CPHS_NOT_FOUND
const requireAccess = requireCphsAccess
const scopeCondition = cphsScopeCondition
const history = recordGovernanceHistory

export type { CphsAccess }

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

  // Acredita la N°11 del PDTP en esta faena. Fuera de la transacción y sin
  // propagar el error: el comité ya existe y la acreditación puede reintentarse.
  await onCphsCommitteeConstituted({
    committeeId: created.id,
    worksiteId: data.worksiteId,
    constitutedOn: data.constitutedOn,
  })
  // Y cierra la obligación abierta por la brecha de organización preventiva, si
  // la había: la acreditación directa de arriba deja la ejecución en la
  // planilla, pero el indicador de plazo de la N°11 sólo mira obligaciones.
  await onPreventiveOrganizationSatisfied({
    worksiteId: data.worksiteId,
    kind: "committee",
    entityId: created.id,
    occurredAt: data.constitutedOn,
    userId: access.userId,
  })
  return created
}

const memberSchema = z.object({
  committeeId: z.string().min(1),
  workerId: z.string().min(1),
  representation: z.enum(["company", "workers"]),
  seat: z.enum(["titular", "suplente"]),
  role: z.enum(["presidente", "secretario", "integrante"]).nullable().optional(),
  electedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
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
      hasFuero: data.hasFuero,
    }).returning()
    if (!created) throw new Error("No se pudo incorporar al integrante.")
    await history(tx, { entityType: "member", entityId: created.id, worksiteId: committee.worksiteId, changeType: "added", reason: `${data.representation} · ${data.seat}`, afterState: created, actorUserId: access.userId })
    return created
  })
}

const dissolveSchema = z.object({
  committeeId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(10).max(1000),
})

/**
 * Disolver es distinto de dejar vencer: el mandato vencido se detecta por fecha
 * (`expireLapsedCommittees`), la disolución es un acto con motivo escrito.
 */
export async function dissolveCommittee(input: unknown, access: CphsAccess) {
  const data = dissolveSchema.parse(input)
  let revocation: Parameters<typeof recordPdtpFulfillmentRevocation>[0] | null = null

  const updated = await db.transaction(async (tx) => {
    const [committee] = await tx.select().from(preventionCommittees)
      .where(eq(preventionCommittees.id, data.committeeId)).limit(1)
    if (!committee) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:cphs:manage", committee.worksiteId)
    if (committee.status !== "active") throw new Error("El comité ya no está vigente.")
    if (committee.version !== data.expectedVersion) {
      throw new Error("El comité cambió mientras lo editabas. Recarga y reintenta.")
    }

    const [updated] = await tx.update(preventionCommittees).set({
      status: "dissolved",
      dissolvedReason: data.reason,
      dissolvedAt: nowIso(),
      version: committee.version + 1,
      updatedAt: nowIso(),
    }).where(and(
      eq(preventionCommittees.id, data.committeeId),
      eq(preventionCommittees.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("El comité cambió mientras lo editabas. Recarga y reintenta.")

    await history(tx, { entityType: "committee", entityId: updated.id, worksiteId: committee.worksiteId, changeType: "dissolved", reason: data.reason, beforeState: committee, afterState: updated, actorUserId: access.userId })

    // Revertir la N°11: el comité que `onCphsCommitteeConstituted` acreditó al
    // crearse ya no existe. Se dispara DESPUÉS del commit (patrón
    // `cancelTrainingSession`), sin propagar el error.
    revocation = {
      sourceType: "cphs",
      sourceId: updated.id,
      worksiteId: committee.worksiteId,
      revokedBy: access.userId,
      reason: data.reason,
    }
    return updated
  })

  if (revocation) await recordPdtpFulfillmentRevocation(revocation)

  return updated
}

const dtRegistrationSchema = z.object({
  committeeId: z.string().min(1),
  dtRegisteredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dtRegistrationReference: z.string().trim().min(3).max(200),
})

/**
 * Registro del acta de constitución ante la Dirección del Trabajo. El acta y el
 * comprobante como archivos se adjuntan por Documentación SST; acá queda el
 * dato verificable (fecha y folio) que la certificación Mutual exige.
 */
export async function recordCommitteeDtRegistration(input: unknown, access: CphsAccess) {
  const data = dtRegistrationSchema.parse(input)

  return db.transaction(async (tx) => {
    const [committee] = await tx.select().from(preventionCommittees)
      .where(eq(preventionCommittees.id, data.committeeId)).limit(1)
    if (!committee) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:cphs:manage", committee.worksiteId)
    if (data.dtRegisteredOn < committee.constitutedOn) {
      throw new Error("El registro ante la Dirección del Trabajo no puede ser anterior a la constitución del comité.")
    }

    const [updated] = await tx.update(preventionCommittees).set({
      dtRegisteredOn: data.dtRegisteredOn,
      dtRegistrationReference: data.dtRegistrationReference,
      updatedAt: nowIso(),
    }).where(eq(preventionCommittees.id, data.committeeId)).returning()
    if (!updated) throw new Error(NOT_FOUND)

    await history(tx, { entityType: "committee", entityId: updated.id, worksiteId: committee.worksiteId, changeType: "dt_registered", reason: `Registrado ante la DT el ${data.dtRegisteredOn} (${data.dtRegistrationReference})`, beforeState: committee, afterState: updated, actorUserId: access.userId })
    return updated
  })
}

const memberExitSchema = z.object({
  memberId: z.string().min(1),
  reason: z.string().trim().min(10).max(1000),
})

/** La renuncia deja el asiento vacante; la paridad pasa a reportarse incumplida. */
export async function resignCommitteeMember(input: unknown, access: CphsAccess) {
  const data = memberExitSchema.parse(input)

  return db.transaction(async (tx) => {
    const context = await loadMemberContext(tx, data.memberId)
    requireAccess(access, "prevention:cphs:manage", context.worksiteId)
    if (context.member.status !== "active") throw new Error("El integrante ya no está activo.")

    // El estado va en el WHERE, no sólo en la guarda de arriba: sin esto,
    // `replaceCommitteeMember` podía ganar la carrera y dejar al integrante en
    // `replaced` con `replacedByMemberId` apuntando al reemplazante, mientras
    // la renuncia quedaba registrada en el historial como si hubiera ocurrido.
    const [updated] = await tx.update(preventionCommitteeMembers).set({
      status: "resigned",
      updatedAt: nowIso(),
    }).where(and(
      eq(preventionCommitteeMembers.id, data.memberId),
      eq(preventionCommitteeMembers.status, "active"),
    )).returning()
    if (!updated) throw new Error("El integrante cambió mientras registrabas la renuncia. Recarga y vuelve a intentarlo.")

    await history(tx, { entityType: "member", entityId: updated.id, worksiteId: context.worksiteId, changeType: "resigned", reason: data.reason, beforeState: context.member, afterState: updated, actorUserId: access.userId })
    return updated
  })
}

const replaceMemberSchema = z.object({
  memberId: z.string().min(1),
  workerId: z.string().min(1),
  reason: z.string().trim().min(10).max(1000),
  electedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

/**
 * El reemplazo hereda representación, asiento y cargo: es la misma silla con
 * otra persona. Cambiarlos a la vez rompería la paridad sin dejar constancia
 * del cambio, así que para eso se renuncia y se incorpora aparte.
 */
export async function replaceCommitteeMember(input: unknown, access: CphsAccess) {
  const data = replaceMemberSchema.parse(input)

  return db.transaction(async (tx) => {
    const context = await loadMemberContext(tx, data.memberId)
    requireAccess(access, "prevention:cphs:manage", context.worksiteId)
    if (context.member.status !== "active") throw new Error("El integrante ya no está activo.")
    if (context.committeeStatus !== "active") throw new Error("Un comité disuelto o vencido no admite reemplazos.")

    const [worker] = await tx.select().from(workers).where(eq(workers.id, data.workerId)).limit(1)
    if (!worker || !worker.isActive) throw new Error("La persona no existe o está inactiva.")
    if (worker.worksiteId !== context.worksiteId) {
      throw new Error("El comité representa a un centro de trabajo: no admite integrantes de otra faena.")
    }
    if (worker.id === context.member.workerId) {
      throw new Error("El reemplazante debe ser una persona distinta.")
    }

    // Primero se libera el asiento: el índice único de integrante activo es
    // parcial sobre (comité, persona), así que el orden importa si la persona
    // entrante ya hubiera pasado por el comité.
    const [replaced] = await tx.update(preventionCommitteeMembers).set({
      status: "replaced",
      updatedAt: nowIso(),
    }).where(and(
      eq(preventionCommitteeMembers.id, data.memberId),
      eq(preventionCommitteeMembers.status, "active"),
      isNull(preventionCommitteeMembers.replacedByMemberId),
    )).returning()
    if (!replaced) throw new Error("El integrante ya no está activo o fue actualizado concurrentemente.")

    const [created] = await tx.insert(preventionCommitteeMembers).values({
      id: `cphsm-${nanoid()}`,
      committeeId: context.member.committeeId,
      workerId: data.workerId,
      representation: context.member.representation,
      seat: context.member.seat,
      role: context.member.role,
      electedOn: data.electedOn ?? null,
      hasFuero: false,
    }).returning()
    if (!created) throw new Error("No se pudo incorporar al reemplazante.")

    await tx.update(preventionCommitteeMembers)
      .set({ replacedByMemberId: created.id })
      .where(eq(preventionCommitteeMembers.id, data.memberId))

    await history(tx, { entityType: "member", entityId: replaced.id, worksiteId: context.worksiteId, changeType: "replaced", reason: data.reason, beforeState: context.member, afterState: created, actorUserId: access.userId })
    return created
  })
}

const cancelMeetingSchema = z.object({
  meetingId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(10).max(1000),
})

/** Una convocatoria que no se realizó se cancela con motivo; no se borra. */
export async function cancelCommitteeMeeting(input: unknown, access: CphsAccess) {
  const data = cancelMeetingSchema.parse(input)

  return db.transaction(async (tx) => {
    const [row] = await tx.select({ meeting: preventionCommitteeMeetings, worksiteId: preventionCommittees.worksiteId })
      .from(preventionCommitteeMeetings)
      .innerJoin(preventionCommittees, eq(preventionCommittees.id, preventionCommitteeMeetings.committeeId))
      .where(eq(preventionCommitteeMeetings.id, data.meetingId)).limit(1)
    if (!row) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:cphs:manage", row.worksiteId)
    if (row.meeting.status === "closed") throw new Error("Un acta cerrada no se puede cancelar.")
    if (row.meeting.status === "cancelled") throw new Error("La sesión ya está cancelada.")
    if (row.meeting.version !== data.expectedVersion) {
      throw new Error("La sesión cambió mientras la editabas. Recarga y reintenta.")
    }

    const [updated] = await tx.update(preventionCommitteeMeetings).set({
      status: "cancelled",
      cancellationReason: data.reason,
      version: row.meeting.version + 1,
      updatedAt: nowIso(),
    }).where(and(
      eq(preventionCommitteeMeetings.id, data.meetingId),
      eq(preventionCommitteeMeetings.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("La sesión cambió mientras la editabas. Recarga y reintenta.")

    await history(tx, { entityType: "meeting", entityId: updated.id, worksiteId: row.worksiteId, changeType: "cancelled", reason: data.reason, beforeState: row.meeting, afterState: updated, actorUserId: access.userId })
    return updated
  })
}

/* ── Prácticas de madurez (Plata y Oro) ───────────────────────────────────── */

const meetingRefSchema = z.object({ meetingId: z.string().min(1) })

async function loadMeetingContext(client: CphsClient, meetingId: string) {
  const [row] = await client.select({
    meeting: preventionCommitteeMeetings,
    committeeId: preventionCommittees.id,
    worksiteId: preventionCommittees.worksiteId,
  })
    .from(preventionCommitteeMeetings)
    .innerJoin(preventionCommittees, eq(preventionCommittees.id, preventionCommitteeMeetings.committeeId))
    .where(eq(preventionCommitteeMeetings.id, meetingId)).limit(1)
  if (!row) throw new Error(NOT_FOUND)
  return row
}

/** Tabla previa (nivel Plata): deja constancia de que la tabla se envió antes. */
export async function markAgendaSent(input: unknown, access: CphsAccess) {
  const data = meetingRefSchema.parse(input)
  return db.transaction(async (tx) => {
    const context = await loadMeetingContext(tx, data.meetingId)
    requireAccess(access, "prevention:cphs:manage", context.worksiteId)
    if (context.meeting.status !== "scheduled") {
      throw new Error("La tabla se envía antes de la sesión: esta ya no está convocada.")
    }
    if (context.meeting.agendaSentAt) throw new Error("La tabla ya fue enviada.")

    // `agendaSentAt IS NULL` en el WHERE: dos envíos concurrentes pisaban el
    // timestamp del primero, que es la evidencia de convocatoria en plazo.
    const [updated] = await tx.update(preventionCommitteeMeetings)
      .set({ agendaSentAt: nowIso(), updatedAt: nowIso() })
      .where(and(
        eq(preventionCommitteeMeetings.id, data.meetingId),
        isNull(preventionCommitteeMeetings.agendaSentAt),
      )).returning()
    if (!updated) throw new Error("La tabla ya fue enviada.")
    await history(tx, { entityType: "meeting", entityId: updated.id, worksiteId: context.worksiteId, changeType: "agenda_sent", reason: "Tabla enviada a los integrantes antes de la sesión", actorUserId: access.userId })
    return updated
  })
}

/** Envío del acta a la alta administración (nivel Oro). */
export async function markMinutesSentToManagement(input: unknown, access: CphsAccess) {
  const data = meetingRefSchema.parse(input)
  return db.transaction(async (tx) => {
    const context = await loadMeetingContext(tx, data.meetingId)
    requireAccess(access, "prevention:cphs:manage", context.worksiteId)
    if (context.meeting.status !== "closed") {
      throw new Error("Sólo se envía a la administración un acta cerrada.")
    }

    const [updated] = await tx.update(preventionCommitteeMeetings)
      .set({ sentToManagementAt: nowIso(), updatedAt: nowIso() })
      .where(eq(preventionCommitteeMeetings.id, data.meetingId)).returning()
    if (!updated) throw new Error(NOT_FOUND)
    await history(tx, { entityType: "meeting", entityId: updated.id, worksiteId: context.worksiteId, changeType: "sent_to_management", reason: "Acta remitida a la alta administración", actorUserId: access.userId })
    return updated
  })
}

const guestSchema = z.object({
  meetingId: z.string().min(1),
  workerId: z.string().min(1).nullable().optional(),
  guestName: z.string().trim().min(3).max(200).nullable().optional(),
}).superRefine((value, ctx) => {
  if (!value.workerId && !value.guestName) {
    ctx.addIssue({ code: "custom", path: ["guestName"], message: "Indica al trabajador invitado o su nombre." })
  }
})

/**
 * Invitar cada mes a una persona trabajadora que no integra el comité es
 * práctica de nivel Plata. El invitado no cuenta para el quórum: éste se calcula
 * sobre integrantes, no sobre asistentes.
 */
export async function addMeetingGuest(input: unknown, access: CphsAccess) {
  const data = guestSchema.parse(input)
  return db.transaction(async (tx) => {
    const context = await loadMeetingContext(tx, data.meetingId)
    requireAccess(access, "prevention:cphs:manage", context.worksiteId)
    if (context.meeting.status === "closed") throw new Error("La sesión está cerrada y no admite cambios.")
    if (context.meeting.status === "cancelled") throw new Error("La sesión está cancelada y no admite cambios.")

    if (data.workerId) {
      const [worker] = await tx.select().from(workers).where(eq(workers.id, data.workerId)).limit(1)
      if (!worker || !worker.isActive) throw new Error("La persona invitada no existe o está inactiva.")
      if (worker.worksiteId !== context.worksiteId) throw new Error("El invitado debe pertenecer a la faena del comité.")
      const [member] = await tx.select({ id: preventionCommitteeMembers.id })
        .from(preventionCommitteeMembers)
        .where(and(
          eq(preventionCommitteeMembers.committeeId, context.committeeId),
          eq(preventionCommitteeMembers.workerId, data.workerId),
          eq(preventionCommitteeMembers.status, "active"),
        )).limit(1)
      if (member) throw new Error("La persona ya integra el comité: se registra como integrante, no como invitada.")
    }

    const [created] = await tx.insert(preventionCommitteeAttendance).values({
      id: `cphsa-${nanoid()}`,
      meetingId: data.meetingId,
      memberId: null,
      guestWorkerId: data.workerId ?? null,
      guestName: data.workerId ? null : data.guestName!,
      attended: true,
    }).returning()
    if (!created) throw new Error("No se pudo registrar al invitado.")
    return created
  })
}

const commissionSchema = z.object({
  committeeId: z.string().min(1),
  name: z.string().trim().min(3).max(200),
  purpose: z.string().trim().min(10).max(2000),
})

/** Comisiones de trabajo del comité (nivel Plata). */
export async function createCommission(input: unknown, access: CphsAccess) {
  const data = commissionSchema.parse(input)
  return db.transaction(async (tx) => {
    const [committee] = await tx.select().from(preventionCommittees)
      .where(eq(preventionCommittees.id, data.committeeId)).limit(1)
    if (!committee) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:cphs:manage", committee.worksiteId)
    if (committee.status !== "active") throw new Error("Un comité disuelto o vencido no admite comisiones nuevas.")

    const [created] = await tx.insert(preventionCommitteeCommissions).values({
      id: `cphscom-${nanoid()}`,
      committeeId: data.committeeId,
      name: data.name,
      purpose: data.purpose,
      createdByUserId: access.userId,
    }).returning()
    if (!created) throw new Error("No se pudo crear la comisión. ¿Ya existe una con ese nombre?")
    await history(tx, { entityType: "commission", entityId: created.id, worksiteId: committee.worksiteId, changeType: "created", reason: data.purpose, afterState: created, actorUserId: access.userId })
    return created
  })
}

const commissionMemberSchema = z.object({
  commissionId: z.string().min(1),
  memberId: z.string().min(1),
})

export async function assignCommissionMember(input: unknown, access: CphsAccess) {
  const data = commissionMemberSchema.parse(input)
  return db.transaction(async (tx) => {
    const [row] = await tx.select({
      commission: preventionCommitteeCommissions,
      worksiteId: preventionCommittees.worksiteId,
      committeeId: preventionCommittees.id,
    })
      .from(preventionCommitteeCommissions)
      .innerJoin(preventionCommittees, eq(preventionCommittees.id, preventionCommitteeCommissions.committeeId))
      .where(eq(preventionCommitteeCommissions.id, data.commissionId)).limit(1)
    if (!row) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:cphs:manage", row.worksiteId)

    const [member] = await tx.select({ id: preventionCommitteeMembers.id })
      .from(preventionCommitteeMembers)
      .where(and(
        eq(preventionCommitteeMembers.id, data.memberId),
        eq(preventionCommitteeMembers.committeeId, row.committeeId),
        eq(preventionCommitteeMembers.status, "active"),
      )).limit(1)
    if (!member) throw new Error("La comisión sólo admite integrantes activos de su propio comité.")

    const [created] = await tx.insert(preventionCommitteeCommissionMembers).values({
      id: `cphscm-${nanoid()}`,
      commissionId: data.commissionId,
      memberId: data.memberId,
    }).onConflictDoNothing().returning()
    return created ?? null
  })
}

export async function listCommissions(committeeId: string, access: CphsAccess) {
  requireAccess(access, "prevention:cphs:view")
  const [committee] = await db.select({ worksiteId: preventionCommittees.worksiteId })
    .from(preventionCommittees).where(eq(preventionCommittees.id, committeeId)).limit(1)
  if (!committee) return []
  requireAccess(access, "prevention:cphs:view", committee.worksiteId)

  return db.select({
    commission: preventionCommitteeCommissions,
    memberCount: sql<number>`count(${preventionCommitteeCommissionMembers.id})::int`,
  })
    .from(preventionCommitteeCommissions)
    .leftJoin(preventionCommitteeCommissionMembers, eq(preventionCommitteeCommissionMembers.commissionId, preventionCommitteeCommissions.id))
    .where(and(
      eq(preventionCommitteeCommissions.committeeId, committeeId),
      eq(preventionCommitteeCommissions.isActive, true),
    ))
    .groupBy(preventionCommitteeCommissions.id)
}

async function loadMemberContext(client: CphsClient, memberId: string) {
  const [row] = await client.select({
    member: preventionCommitteeMembers,
    worksiteId: preventionCommittees.worksiteId,
    committeeStatus: preventionCommittees.status,
  })
    .from(preventionCommitteeMembers)
    .innerJoin(preventionCommittees, eq(preventionCommittees.id, preventionCommitteeMembers.committeeId))
    .where(eq(preventionCommitteeMembers.id, memberId)).limit(1)
  if (!row) throw new Error(NOT_FOUND)
  return row
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
  scheduledFor: z.iso.datetime({ offset: true }),
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
      code: `CPHS-${codeYear()}-${nanoid(8).toUpperCase()}`,
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
  heldAt: z.iso.datetime({ offset: true }),
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
}).superRefine((value, ctx) => {
  // Una sesión no se realiza en el futuro. Sin esta cota, un acta fechada en
  // 2030 dejaba la cadencia "al día" para siempre: `assessMeetingCadence` mide
  // contra la última sesión cerrada y nunca vuelve a reclamar.
  if (new Date(value.heldAt).getTime() > Date.now()) {
    ctx.addIssue({ code: "custom", path: ["heldAt"], message: "La sesión no puede realizarse en el futuro." })
  }
})

/**
 * Cierra el acta. Exige quórum real —mayoría de titulares Y presencia de ambas
 * representaciones, ver `assessQuorum`—: sin él la sesión no produce acuerdos
 * válidos, así que el cierre se rechaza en vez de registrar una reunión que
 * el DS 44 no reconocería. Cada acuerdo se deriva a CAPA común.
 */
export async function closeCommitteeMeeting(input: unknown, access: CphsAccess) {
  const data = closeMeetingSchema.parse(input)
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
    // La cota inferior necesita el comité, así que va acá y no en el esquema.
    if (todayInChile(data.heldAt) < row.committee.constitutedOn) {
      throw new Error("La sesión no puede ser anterior a la constitución del comité.")
    }

    const members = await tx.select().from(preventionCommitteeMembers)
      .where(eq(preventionCommitteeMembers.committeeId, row.committee.id))

    // La asistencia es nominativa: un id ajeno al comité no es una omisión, es
    // un acta que nombra a quien no integra el órgano.
    const committeeMemberIds = new Set(members.map((member) => member.id))
    const reportedMemberIds = [...data.attendedMemberIds, ...data.excuses.map((excuse) => excuse.memberId)]
    const foreignMemberId = reportedMemberIds.find((memberId) => !committeeMemberIds.has(memberId))
    if (foreignMemberId) {
      throw new Error("La asistencia sólo admite integrantes de este comité.")
    }

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
      // Nombrar la representación ausente: "3 de 3 presentes pero sin quórum"
      // es incomprensible sin decir qué falta.
      const missing = quorum.missingRepresentations
        .map((representation) => (REPRESENTATION_LABELS[representation] ?? representation).toLowerCase())
        .join(" ni ")
      throw new Error(missing
        ? `La sesión no alcanzó quórum: no hubo ${missing} presente. El comité es paritario y sesiona con ambas representaciones. No puede cerrarse como sesión válida.`
        : `La sesión no alcanzó quórum: ${quorum.effective} de ${quorum.required} requeridos. No puede cerrarse como sesión válida.`)
    }

    // La asistencia se materializa al convocar, así que el padrón pudo cambiar
    // después: quien se incorporó luego no tiene fila y quien fue reemplazado
    // conserva la suya. Se reconcilia contra el padrón vigente antes de
    // escribir, para que el acta nombre a quienes integran hoy el comité.
    // Quien ya no integra pero sí fue reportado (asistió o se excusó antes de
    // salir) conserva su fila: reconciliar no borra hechos registrados.
    const rosterMemberIds = new Set([
      ...members.filter((member) => member.status === "active").map((member) => member.id),
      ...reportedMemberIds,
    ])
    const attendanceRows = await tx.select({
      id: preventionCommitteeAttendance.id,
      memberId: preventionCommitteeAttendance.memberId,
      attended: preventionCommitteeAttendance.attended,
      excuseReason: preventionCommitteeAttendance.excuseReason,
    })
      .from(preventionCommitteeAttendance)
      .where(eq(preventionCommitteeAttendance.meetingId, row.meeting.id))

    const staleRowIds = attendanceRows
      .filter((attendance) => attendance.memberId !== null
        && !rosterMemberIds.has(attendance.memberId)
        && !attendance.attended
        && attendance.excuseReason === null)
      .map((attendance) => attendance.id)
    if (staleRowIds.length > 0) {
      await tx.delete(preventionCommitteeAttendance)
        .where(inArray(preventionCommitteeAttendance.id, staleRowIds))
    }

    const convenedMemberIds = new Set(attendanceRows.flatMap((attendance) => attendance.memberId ? [attendance.memberId] : []))
    const missingRows = [...rosterMemberIds].filter((memberId) => !convenedMemberIds.has(memberId))
    if (missingRows.length > 0) {
      await tx.insert(preventionCommitteeAttendance).values(missingRows.map((memberId) => ({
        id: `cphsa-${nanoid()}`,
        meetingId: row.meeting.id,
        memberId,
      })))
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
      // Sin columna `status`: el estado del acuerdo ES el de su CAPA. Ver la
      // decisión "CAPA motor único" — un espejo acá se desincroniza y miente.
      await tx.insert(preventionCommitteeAgreements).values({
        id: `cphsag-${nanoid()}`,
        meetingId: row.meeting.id,
        description: agreement.description,
        capaActionId: capa.id,
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

    // Sin acreditación PDTP: la reunión mensual del comité (antes N°13) salió
    // del programa al del propio CPHS (D5 del diseño 2026-08-12).

    return { meeting: updated, agreementsCreated: data.agreements.length, quorum }
  })

  return result
}

/* ── Revisión por la dirección ────────────────────────────────────────────── */

const managementReviewSchema = z.object({
  worksiteId: z.string().min(1).nullable().optional(),
  periodLabel: z.string().trim().min(4).max(60),
  heldAt: z.iso.datetime({ offset: true }),
  inputs: z.record(z.string(), z.unknown()),
})

export async function createManagementReview(input: unknown, access: CphsAccess) {
  const data = managementReviewSchema.parse(input)
  requireAccess(access, "prevention:governance:review", data.worksiteId ?? undefined)

  const [created] = await db.insert(preventionManagementReviews).values({
    id: `mgmtrev-${nanoid()}`,
    code: `RD-${codeYear()}-${nanoid(6).toUpperCase()}`,
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
    // La faena de la revisión sólo se conoce después de cargarla. Hoy el
    // permiso lo tienen roles globales, pero el alcance tiene que aplicarse
    // igual: si mañana se le da a un rol por faena, cerrar la revisión de otra
    // no puede quedar permitido por omisión.
    requireAccess(access, "prevention:governance:review", review.worksiteId ?? undefined)
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

/**
 * Marca vencidos los comités cuyo mandato ya pasó.
 *
 * Deja traza como las otras tres transiciones del comité (constitución,
 * disolución, registro DT): un órgano que deja de ser válido sin una línea en
 * el historial es un cambio de estado que nadie puede explicar después. Sube
 * `version` porque la pantalla edita con concurrencia optimista y el comité
 * cambió de verdad.
 *
 * Idempotente: sólo toma filas `active`, así que una segunda corrida el mismo
 * día no encuentra nada que expirar ni duplica el historial.
 */
export async function expireLapsedCommittees() {
  const today = todayInChile()
  const updated = await db.transaction(async (tx) => {
    const updated = await tx.update(preventionCommittees)
      .set({ status: "expired", version: sql`${preventionCommittees.version} + 1`, updatedAt: nowIso() })
      .where(and(
        eq(preventionCommittees.status, "active"),
        sql`${preventionCommittees.mandateEndsOn} < ${today}`,
      ))
      .returning()

    for (const committee of updated) {
      await history(tx, {
        entityType: "committee",
        entityId: committee.id,
        worksiteId: committee.worksiteId,
        changeType: "expired",
        reason: `Mandato vencido el ${committee.mandateEndsOn}`,
        afterState: committee,
        actorUserId: null,
      })
    }
    return updated
  })

  // Revertir la N°11 de cada comité vencido, uno por uno y DESPUÉS del commit:
  // `recordPdtpFulfillmentRevocation` no propaga sus propios errores, así que
  // uno fallando nunca aborta el resto del barrido.
  for (const committee of updated) {
    await recordPdtpFulfillmentRevocation({
      sourceType: "cphs",
      sourceId: committee.id,
      worksiteId: committee.worksiteId,
      reason: `Mandato vencido el ${committee.mandateEndsOn}`,
    })
  }

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
    // Un invitado no es un integrante convocado: contarlo acá infla el quórum
    // aparente. Se filtra por member_id, y los invitados se cuentan aparte.
    convened: sql<number>`(SELECT COUNT(*)::int FROM prevention_committee_attendance a WHERE a.meeting_id = ${preventionCommitteeMeetings.id} AND a.member_id IS NOT NULL)`,
    attended: sql<number>`(SELECT COUNT(*)::int FROM prevention_committee_attendance a WHERE a.meeting_id = ${preventionCommitteeMeetings.id} AND a.member_id IS NOT NULL AND a.attended = true)`,
    guests: sql<number>`(SELECT COUNT(*)::int FROM prevention_committee_attendance a WHERE a.meeting_id = ${preventionCommitteeMeetings.id} AND a.member_id IS NULL)`,
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
  // Una revisión sin faena es corporativa y la ve todo el que puede revisar;
  // la de una faena, sólo quien la tiene en su alcance. Con `mode: "all"` la
  // condición es `undefined` y no hay que envolverla: `or(isNull(x), undefined)`
  // colapsaría a `isNull(x)` y escondería justamente las revisiones por faena.
  const scoped = cphsScopeCondition(access.scope, preventionManagementReviews.worksiteId)
  return db.select({ review: preventionManagementReviews, worksiteName: worksites.name })
    .from(preventionManagementReviews)
    .leftJoin(worksites, eq(preventionManagementReviews.worksiteId, worksites.id))
    .where(scoped ? or(isNull(preventionManagementReviews.worksiteId), scoped) : undefined)
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
