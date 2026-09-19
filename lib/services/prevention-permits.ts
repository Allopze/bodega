import { createHash } from "node:crypto"
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core"
import { db, type DB, type Tx } from "@/db"
import {
  preventionJsaSteps,
  preventionPermitControls,
  preventionPermitCrew,
  preventionPermitHistory,
  preventionPermitIsolations,
  preventionPermitMeasurements,
  preventionPermitTypes,
  preventionWorkPermits,
  users,
  workers,
  worksites,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { getUserIdsWithPermission } from "@/lib/services/notification-targeting"
import { verifyPreventionAckToken } from "@/lib/services/prevention-ack-token"
import {
  assessPermitActivation,
  isPermitExpired,
  plannedDurationHours,
  PERMIT_TRANSITIONS,
  type PermitBlocker,
  type PermitCrewRow,
} from "@/lib/prevention/permits"
import {
  jsaStepSchema,
  permitControlVerificationSchema,
  permitCrewAckSchema,
  permitExtensionSchema,
  permitIsolationApplySchema,
  permitIsolationRemoveSchema,
  permitIsolationSchema,
  permitMeasurementSchema,
  permitTransitionSchema,
  permitTypeSchema,
  workPermitSchema,
} from "@/lib/validation/prevention-module/permits"
import { codeYear } from "@/lib/utils"

type Client = DB | Tx

export interface PermitAccess {
  userId: string
  scope: WorksiteScope
  permissions: readonly string[]
}

const NOT_FOUND = "Permiso de trabajo no encontrado o fuera de alcance."

function nowIso() {
  return new Date().toISOString()
}

function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

function requireAccess(access: PermitAccess, permission: string, worksiteId?: string) {
  if (!access.permissions.includes(permission) || (worksiteId && !scopeAllows(access.scope, worksiteId))) {
    throw new Error(NOT_FOUND)
  }
}

function scopeCondition(scope: WorksiteScope, column: AnyPgColumn) {
  if (scope.mode === "all") return undefined
  if (scope.mode === "none" || scope.ids.length === 0) return sql`false`
  return inArray(column, scope.ids)
}

function permitCode() {
  return `PT-${codeYear()}-${nanoid(8).toUpperCase()}`
}

async function history(client: Client, args: {
  permitId: string
  changeType: string
  fromStatus?: string | null
  toStatus?: string | null
  reason: string
  beforeState?: unknown
  afterState?: unknown
  actorUserId?: string | null
}) {
  await client.insert(preventionPermitHistory).values({
    id: `ptrh-${nanoid()}`,
    permitId: args.permitId,
    changeType: args.changeType,
    fromStatus: args.fromStatus ?? null,
    toStatus: args.toStatus ?? null,
    reason: args.reason,
    beforeState: args.beforeState ?? null,
    afterState: args.afterState ?? null,
    actorUserId: args.actorUserId ?? null,
  })
}

/**
 * Toda mutación hija (controles, aislamientos, mediciones) es una entrada de la
 * habilitación: si no mueve `version`, el CAS de `transitionWorkPermit` no ve el
 * cambio y activa el permiso con una evaluación ya obsoleta.
 *
 * Se incrementa en SQL, no con `version + 1` leído en memoria, para no perder el
 * bump si dos mutaciones hijas corren a la vez.
 */
async function bumpPermitVersion(client: Client, permitId: string, now: string) {
  await client.update(preventionWorkPermits)
    .set({ version: sql`${preventionWorkPermits.version} + 1`, updatedAt: now })
    .where(eq(preventionWorkPermits.id, permitId))
}

/* ── Catálogo ─────────────────────────────────────────────────────────────── */

export async function createPermitType(input: unknown, access: PermitAccess) {
  requireAccess(access, "prevention:permits:manage")
  const data = permitTypeSchema.parse(input)
  const [created] = await db.insert(preventionPermitTypes).values({
    id: `pmtype-${nanoid()}`,
    code: data.code,
    name: data.name,
    description: data.description ?? null,
    competencyTaskKey: data.competencyTaskKey ?? null,
    requiresIsolation: data.requiresIsolation,
    requiresMeasurement: data.requiresMeasurement,
    requiresJsa: data.requiresJsa,
    requiresCrewAcknowledgement: data.requiresCrewAcknowledgement,
    measurementValidityMinutes: data.measurementValidityMinutes ?? null,
    measurementCalibrationValidityDays: data.measurementCalibrationValidityDays ?? null,
    maxDurationHours: data.maxDurationHours,
    legalBasis: data.legalBasis,
    createdByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo crear el tipo de permiso.")
  return created
}

/* ── Permiso ──────────────────────────────────────────────────────────────── */

export async function createWorkPermit(input: unknown, access: PermitAccess) {
  const data = workPermitSchema.parse(input)
  requireAccess(access, "prevention:permits:request", data.worksiteId)

  return db.transaction(async (tx) => {
    const [type] = await tx.select().from(preventionPermitTypes)
      .where(eq(preventionPermitTypes.id, data.permitTypeId)).limit(1)
    if (!type || !type.isActive) throw new Error("El tipo de permiso no existe o está inactivo.")

    const duration = plannedDurationHours(data.plannedStartAt, data.plannedEndAt)
    if (duration > type.maxDurationHours) {
      throw new Error(`La ventana solicitada (${duration} h) supera el máximo de ${type.maxDurationHours} h de este tipo de permiso.`)
    }

    const id = `permit-${nanoid()}`
    const [created] = await tx.insert(preventionWorkPermits).values({
      id,
      code: permitCode(),
      permitTypeId: data.permitTypeId,
      worksiteId: data.worksiteId,
      taskDescription: data.taskDescription,
      location: data.location,
      riskEntryId: data.riskEntryId ?? null,
      supervisorUserId: data.supervisorUserId,
      plannedStartAt: data.plannedStartAt,
      plannedEndAt: data.plannedEndAt,
      status: "draft",
      requestedByUserId: access.userId,
    }).returning()
    if (!created) throw new Error("No se pudo crear el permiso.")

    await addCrewMembers(tx, id, data.worksiteId, data.crew)

    if (data.controls.length > 0) {
      await tx.insert(preventionPermitControls).values(data.controls.map((control) => ({
        id: `pmctl-${nanoid()}`,
        permitId: id,
        description: control.description,
        isMandatory: control.isMandatory,
      })))
    }

    await history(tx, { permitId: id, changeType: "created", toStatus: "draft", reason: `Permiso ${type.name} solicitado`, afterState: created, actorUserId: access.userId })
    return created
  })
}

async function addCrewMembers(
  tx: Tx,
  permitId: string,
  worksiteId: string,
  crew: { workerId: string; role: string }[],
) {
  if (crew.length === 0) return

  const workerIds = crew.map((item) => item.workerId)
  const rows = await tx.select({ id: workers.id, worksiteId: workers.worksiteId, isActive: workers.isActive })
    .from(workers).where(inArray(workers.id, workerIds))
  const known = new Map(rows.map((row) => [row.id, row]))
  for (const workerId of workerIds) {
    const worker = known.get(workerId)
    if (!worker || !worker.isActive) throw new Error("Un integrante de la cuadrilla no existe o está inactivo.")
    if (worker.worksiteId !== worksiteId) throw new Error("No se puede asignar a la cuadrilla una persona de otra faena.")
  }

  await tx.insert(preventionPermitCrew).values(crew.map((member) => ({
    id: `pmcrew-${nanoid()}`,
    permitId,
    workerId: member.workerId,
    role: member.role,
  })))
}

export async function saveJsaSteps(input: unknown, access: PermitAccess) {
  const data = jsaStepSchema.parse(input)
  return db.transaction(async (tx) => {
    const permit = await loadPermitForMutation(tx, data.permitId, access, "prevention:permits:request")
    if (!["draft", "pending_approval"].includes(permit.status)) {
      throw new Error("El AST sólo puede editarse mientras el permiso no esté aprobado.")
    }
    await tx.delete(preventionJsaSteps).where(eq(preventionJsaSteps.permitId, permit.id))
    await tx.insert(preventionJsaSteps).values(data.steps.map((step) => ({
      id: `jsa-${nanoid()}`,
      permitId: permit.id,
      stepOrder: step.stepOrder,
      stepDescription: step.stepDescription,
      hazards: step.hazards,
      controls: step.controls,
      residualRisk: step.residualRisk,
      createdByUserId: access.userId,
    })))
    await history(tx, { permitId: permit.id, changeType: "jsa", reason: `AST actualizado con ${data.steps.length} paso(s)`, actorUserId: access.userId })
    return { steps: data.steps.length }
  })
}

async function loadPermitForMutation(tx: Tx, permitId: string, access: PermitAccess, permission: string) {
  const [permit] = await tx.select().from(preventionWorkPermits)
    .where(eq(preventionWorkPermits.id, permitId)).limit(1)
  if (!permit) throw new Error(NOT_FOUND)
  requireAccess(access, permission, permit.worksiteId)
  return permit
}

export async function verifyPermitControl(input: unknown, access: PermitAccess) {
  const data = permitControlVerificationSchema.parse(input)
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ control: preventionPermitControls, permit: preventionWorkPermits })
      .from(preventionPermitControls)
      .innerJoin(preventionWorkPermits, eq(preventionPermitControls.permitId, preventionWorkPermits.id))
      .where(eq(preventionPermitControls.id, data.controlId)).limit(1)
    if (!row) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:permits:verify", row.permit.worksiteId)
    if (["closed", "cancelled", "rejected"].includes(row.permit.status)) {
      throw new Error("No se pueden verificar controles de un permiso terminado.")
    }
    const now = nowIso()
    const [updated] = await tx.update(preventionPermitControls).set({
      verified: data.verified,
      verifiedByUserId: data.verified ? access.userId : null,
      verifiedAt: data.verified ? now : null,
      notApplicableReason: data.verified ? null : data.notApplicableReason ?? null,
    }).where(eq(preventionPermitControls.id, data.controlId)).returning()
    if (!updated) throw new Error("No se pudo registrar la verificación.")
    await bumpPermitVersion(tx, row.permit.id, now)
    return updated
  })
}

export async function addPermitIsolation(input: unknown, access: PermitAccess) {
  const data = permitIsolationSchema.parse(input)
  return db.transaction(async (tx) => {
    const permit = await loadPermitForMutation(tx, data.permitId, access, "prevention:permits:verify")
    if (["closed", "cancelled", "rejected"].includes(permit.status)) {
      throw new Error("No se pueden registrar aislamientos en un permiso terminado.")
    }
    const [created] = await tx.insert(preventionPermitIsolations).values({
      id: `pmiso-${nanoid()}`,
      permitId: permit.id,
      energySource: data.energySource,
      equipmentTag: data.equipmentTag,
      isolationMethod: data.isolationMethod,
      lockTagId: data.lockTagId,
    }).returning()
    if (!created) throw new Error("No se pudo registrar el aislamiento.")
    await bumpPermitVersion(tx, permit.id, nowIso())
    await history(tx, { permitId: permit.id, changeType: "isolation_added", reason: `Aislamiento ${data.lockTagId} en ${data.equipmentTag}`, actorUserId: access.userId })
    return created
  })
}

export async function applyPermitIsolation(input: unknown, access: PermitAccess) {
  const data = permitIsolationApplySchema.parse(input)
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ isolation: preventionPermitIsolations, permit: preventionWorkPermits })
      .from(preventionPermitIsolations)
      .innerJoin(preventionWorkPermits, eq(preventionPermitIsolations.permitId, preventionWorkPermits.id))
      .where(eq(preventionPermitIsolations.id, data.isolationId)).limit(1)
    if (!row) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:permits:verify", row.permit.worksiteId)
    if (row.isolation.removedAt) throw new Error("El aislamiento ya fue retirado.")

    const now = nowIso()
    const [updated] = await tx.update(preventionPermitIsolations).set({
      appliedByUserId: access.userId,
      appliedAt: row.isolation.appliedAt ?? now,
      verifiedZeroEnergy: data.verifiedZeroEnergy,
    }).where(eq(preventionPermitIsolations.id, data.isolationId)).returning()
    if (!updated) throw new Error("No se pudo aplicar el aislamiento.")
    await bumpPermitVersion(tx, row.permit.id, now)
    await history(tx, { permitId: row.permit.id, changeType: "isolation_applied", reason: `Aislamiento ${row.isolation.lockTagId} aplicado${data.verifiedZeroEnergy ? " con energía cero verificada" : ""}`, actorUserId: access.userId })
    return updated
  })
}

/**
 * Retirar un aislamiento con el permiso vigente equivale a devolver energía a
 * un equipo intervenido: sólo se admite con el permiso cerrado o suspendido.
 */
export async function removePermitIsolation(input: unknown, access: PermitAccess) {
  const data = permitIsolationRemoveSchema.parse(input)
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ isolation: preventionPermitIsolations, permit: preventionWorkPermits })
      .from(preventionPermitIsolations)
      .innerJoin(preventionWorkPermits, eq(preventionPermitIsolations.permitId, preventionWorkPermits.id))
      .where(eq(preventionPermitIsolations.id, data.isolationId)).limit(1)
    if (!row) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:permits:verify", row.permit.worksiteId)
    if (!row.isolation.appliedAt) throw new Error("No se puede retirar un aislamiento que nunca se aplicó.")
    if (row.isolation.removedAt) throw new Error("El aislamiento ya fue retirado.")
    if (row.permit.status === "active") {
      throw new Error("No se puede retirar un aislamiento con el permiso vigente: suspende o cierra el permiso primero.")
    }

    const now = nowIso()
    const [updated] = await tx.update(preventionPermitIsolations).set({
      removedByUserId: access.userId,
      removedAt: now,
    }).where(eq(preventionPermitIsolations.id, data.isolationId)).returning()
    if (!updated) throw new Error("No se pudo retirar el aislamiento.")
    await bumpPermitVersion(tx, row.permit.id, now)
    await history(tx, { permitId: row.permit.id, changeType: "isolation_removed", reason: data.reason, actorUserId: access.userId })
    return updated
  })
}

export async function addPermitMeasurement(input: unknown, access: PermitAccess) {
  const data = permitMeasurementSchema.parse(input)
  return db.transaction(async (tx) => {
    const permit = await loadPermitForMutation(tx, data.permitId, access, "prevention:permits:verify")
    if (["closed", "cancelled", "rejected"].includes(permit.status)) {
      throw new Error("No se pueden registrar mediciones en un permiso terminado.")
    }
    // El rango se evalúa aquí y se persiste: la decisión de habilitación no
    // debe depender de recalcular límites que pudieron cambiar después.
    const withinRange =
      (data.acceptableMin == null || data.value >= data.acceptableMin)
      && (data.acceptableMax == null || data.value <= data.acceptableMax)

    const [created] = await tx.insert(preventionPermitMeasurements).values({
      id: `pmmeas-${nanoid()}`,
      permitId: permit.id,
      parameter: data.parameter,
      value: String(data.value),
      unit: data.unit,
      acceptableMin: data.acceptableMin == null ? null : String(data.acceptableMin),
      acceptableMax: data.acceptableMax == null ? null : String(data.acceptableMax),
      withinRange,
      equipmentTag: data.equipmentTag,
      calibrationDate: data.calibrationDate ?? null,
      takenByUserId: access.userId,
      takenAt: data.takenAt,
    }).returning()
    if (!created) throw new Error("No se pudo registrar la medición.")
    await bumpPermitVersion(tx, permit.id, nowIso())
    await history(tx, { permitId: permit.id, changeType: "measurement", reason: `${data.parameter} = ${data.value} ${data.unit} (${withinRange ? "en rango" : "fuera de rango"})`, actorUserId: access.userId })
    return created
  })
}

/* ── Habilitación ─────────────────────────────────────────────────────────── */

/**
 * La cuadrilla del permiso, con su acuse del AST.
 *
 * Hasta el 2026-09-19 esto además cruzaba a cada integrante contra el módulo de
 * competencias y devolvía quién no estaba habilitado. Ese módulo se retiró con
 * el seguimiento de capacitación por persona, así que la habilitación
 * individual ya no se verifica acá ni en ninguna otra parte: el permiso exige
 * cuadrilla, controles, aislaciones, mediciones, AST y acuse, y la competencia
 * de cada integrante queda fuera del control automático.
 */
async function resolveCrewEligibility(client: Client, permitId: string) {
  const crewRows = await client.select({
    id: preventionPermitCrew.id,
    workerId: preventionPermitCrew.workerId,
    // PER-001: el acuse del AST entra en la evaluación de habilitación.
    acknowledgedAt: preventionPermitCrew.acknowledgedAt,
    workerFirstName: workers.firstName,
    workerLastName: workers.lastName,
  })
    .from(preventionPermitCrew)
    .innerJoin(workers, eq(preventionPermitCrew.workerId, workers.id))
    .where(eq(preventionPermitCrew.permitId, permitId))

  const crew: PermitCrewRow[] = crewRows.map((row) => ({
    id: row.id,
    workerId: row.workerId,
    label: `${row.workerLastName}, ${row.workerFirstName}`,
    acknowledgedAt: row.acknowledgedAt,
  }))

  return { crew }
}

export async function evaluatePermitReadiness(permitId: string, access: PermitAccess): Promise<{ allowed: boolean; blockers: PermitBlocker[] }> {
  requireAccess(access, "prevention:permits:view")
  const [permit] = await db.select().from(preventionWorkPermits)
    .where(eq(preventionWorkPermits.id, permitId)).limit(1)
  if (!permit || !scopeAllows(access.scope, permit.worksiteId)) throw new Error(NOT_FOUND)
  const [type] = await db.select().from(preventionPermitTypes)
    .where(eq(preventionPermitTypes.id, permit.permitTypeId)).limit(1)
  if (!type) throw new Error(NOT_FOUND)

  const [controls, isolations, measurements, jsaCount, eligibility] = await Promise.all([
    db.select().from(preventionPermitControls).where(eq(preventionPermitControls.permitId, permitId)),
    db.select().from(preventionPermitIsolations).where(eq(preventionPermitIsolations.permitId, permitId)),
    db.select().from(preventionPermitMeasurements).where(eq(preventionPermitMeasurements.permitId, permitId)),
    db.select({ count: sql<number>`count(*)::int` }).from(preventionJsaSteps).where(eq(preventionJsaSteps.permitId, permitId)),
    resolveCrewEligibility(db, permitId),
  ])

  return assessPermitActivation({
    type: {
      requiresIsolation: type.requiresIsolation,
      requiresMeasurement: type.requiresMeasurement,
      requiresJsa: type.requiresJsa,
      requiresCrewAcknowledgement: type.requiresCrewAcknowledgement,
      measurementValidityMinutes: type.measurementValidityMinutes,
      measurementCalibrationValidityDays: type.measurementCalibrationValidityDays,
      maxDurationHours: type.maxDurationHours,
    },
    controls: controls.map((control) => ({
      id: control.id,
      description: control.description,
      isMandatory: control.isMandatory,
      verified: control.verified,
      notApplicableReason: control.notApplicableReason,
    })),
    isolations: isolations.map((item) => ({
      id: item.id,
      equipmentTag: item.equipmentTag,
      appliedAt: item.appliedAt,
      verifiedZeroEnergy: item.verifiedZeroEnergy,
      removedAt: item.removedAt,
    })),
    measurements: measurements.map((item) => ({
      parameter: item.parameter,
      withinRange: item.withinRange,
      takenAt: item.takenAt,
      calibrationDate: item.calibrationDate,
    })),
    jsaStepCount: jsaCount[0]?.count ?? 0,
    crew: eligibility.crew,
    plannedEndAt: permit.extendedUntilAt ?? permit.plannedEndAt,
    now: nowIso(),
  })
}

const TRANSITION_PERMISSION: Record<string, string> = {
  pending_approval: "prevention:permits:request",
  approved: "prevention:permits:approve",
  rejected: "prevention:permits:approve",
  active: "prevention:permits:activate",
  suspended: "prevention:permits:suspend",
  closed: "prevention:permits:close",
  cancelled: "prevention:permits:request",
}

/**
 * Única puerta de cambio de estado. Activar recalcula la habilitación completa
 * en el momento: no se hereda una evaluación previa que pudo quedar obsoleta.
 */
export async function transitionWorkPermit(input: unknown, access: PermitAccess) {
  const data = permitTransitionSchema.parse(input)
  const permission = TRANSITION_PERMISSION[data.toStatus]
  if (!permission) throw new Error("Transición no soportada.")

  // La habilitación se evalúa fuera de la transacción de escritura para no
  // sostener locks durante las consultas de competencias y acreditación.
  let readiness: { allowed: boolean; blockers: PermitBlocker[] } | null = null
  if (data.toStatus === "active") {
    readiness = await evaluatePermitReadiness(data.permitId, {
      ...access,
      permissions: [...access.permissions, "prevention:permits:view"],
    })
  }

  return db.transaction(async (tx) => {
    const [permit] = await tx.select().from(preventionWorkPermits)
      .where(eq(preventionWorkPermits.id, data.permitId)).limit(1)
    if (!permit) throw new Error(NOT_FOUND)
    requireAccess(access, permission, permit.worksiteId)
    if (permit.version !== data.expectedVersion) throw new Error("El permiso cambió mientras lo editabas. Recarga y reintenta.")
    if (!PERMIT_TRANSITIONS[permit.status]?.includes(data.toStatus)) {
      throw new Error(`Transición de permiso inválida: ${permit.status} → ${data.toStatus}.`)
    }
    if (data.toStatus === "approved" && permit.requestedByUserId === access.userId) {
      throw new Error("Quien solicita el permiso no puede aprobarlo.")
    }
    if (data.toStatus === "active" && readiness && !readiness.allowed) {
      throw new Error(`El permiso no puede habilitarse: ${readiness.blockers.map((item) => item.detail).join(" ")}`)
    }
    if (data.toStatus === "closed") {
      const live = await tx.select({ id: preventionPermitIsolations.id })
        .from(preventionPermitIsolations)
        .where(and(
          eq(preventionPermitIsolations.permitId, permit.id),
          sql`${preventionPermitIsolations.appliedAt} IS NOT NULL AND ${preventionPermitIsolations.removedAt} IS NULL`,
        ))
      if (live.length > 0) {
        throw new Error(`No se puede cerrar el permiso con ${live.length} aislamiento(s) aplicados sin retirar.`)
      }
    }

    const now = nowIso()
    const patch: Record<string, unknown> = {
      status: data.toStatus,
      version: permit.version + 1,
      updatedAt: now,
    }
    if (data.toStatus === "pending_approval") patch.submittedAt = now
    if (data.toStatus === "approved") { patch.approvedByUserId = access.userId; patch.approvedAt = now }
    if (data.toStatus === "rejected") { patch.rejectionReason = data.reason }
    if (data.toStatus === "active") { patch.activatedByUserId = access.userId; patch.activatedAt = now; patch.suspendedAt = null; patch.suspendedByUserId = null; patch.suspensionReason = null }
    if (data.toStatus === "suspended") { patch.suspendedByUserId = access.userId; patch.suspendedAt = now; patch.suspensionReason = data.reason }
    if (data.toStatus === "closed") { patch.closedByUserId = access.userId; patch.closedAt = now; patch.closureSummary = data.reason }
    if (data.toStatus === "cancelled") { patch.cancelledByUserId = access.userId; patch.cancelledAt = now; patch.cancellationReason = data.reason }

    const [updated] = await tx.update(preventionWorkPermits).set(patch)
      .where(and(eq(preventionWorkPermits.id, permit.id), eq(preventionWorkPermits.version, data.expectedVersion)))
      .returning()
    if (!updated) throw new Error("El permiso cambió mientras lo editabas. Recarga y reintenta.")
    await history(tx, { permitId: permit.id, changeType: "status", fromStatus: permit.status, toStatus: data.toStatus, reason: data.reason, beforeState: permit, afterState: updated, actorUserId: access.userId })
    return updated
  })
}

export async function extendWorkPermit(input: unknown, access: PermitAccess) {
  const data = permitExtensionSchema.parse(input)
  return db.transaction(async (tx) => {
    const permit = await loadPermitForMutation(tx, data.permitId, access, "prevention:permits:approve")
    if (permit.version !== data.expectedVersion) throw new Error("El permiso cambió mientras lo editabas. Recarga y reintenta.")
    if (!["approved", "active"].includes(permit.status)) {
      throw new Error("Sólo un permiso aprobado o vigente puede extenderse.")
    }
    const currentEnd = permit.extendedUntilAt ?? permit.plannedEndAt
    if (Date.parse(data.extendedUntilAt) <= Date.parse(currentEnd)) {
      throw new Error("La extensión debe ser posterior al término vigente.")
    }
    const [type] = await tx.select().from(preventionPermitTypes)
      .where(eq(preventionPermitTypes.id, permit.permitTypeId)).limit(1)
    if (!type) throw new Error(NOT_FOUND)
    const total = plannedDurationHours(permit.plannedStartAt, data.extendedUntilAt)
    if (total > type.maxDurationHours) {
      throw new Error(`La extensión llevaría el permiso a ${Math.round(total)} h y el máximo del tipo es ${type.maxDurationHours} h.`)
    }

    const now = nowIso()
    const [updated] = await tx.update(preventionWorkPermits).set({
      extendedUntilAt: data.extendedUntilAt,
      extensionReason: data.reason,
      version: permit.version + 1,
      updatedAt: now,
    }).where(and(eq(preventionWorkPermits.id, permit.id), eq(preventionWorkPermits.version, data.expectedVersion))).returning()
    if (!updated) throw new Error("El permiso cambió mientras lo editabas. Recarga y reintenta.")
    await history(tx, { permitId: permit.id, changeType: "extended", reason: data.reason, beforeState: permit, afterState: updated, actorUserId: access.userId })
    return updated
  })
}

/** Acuse del propio integrante de la cuadrilla sobre el AST y los controles. */
export async function acknowledgePermitCrew(input: unknown, access: PermitAccess) {
  requireAccess(access, "prevention:permits:view")
  const data = permitCrewAckSchema.parse(input)

  return db.transaction(async (tx) => {
    const [row] = await tx.select({
      crew: preventionPermitCrew,
      permit: preventionWorkPermits,
      crewUserId: users.id,
    })
      .from(preventionPermitCrew)
      .innerJoin(preventionWorkPermits, eq(preventionPermitCrew.permitId, preventionWorkPermits.id))
      .leftJoin(users, eq(users.workerId, preventionPermitCrew.workerId))
      .where(eq(preventionPermitCrew.id, data.crewId)).limit(1)
    if (!row) throw new Error(NOT_FOUND)
    if (row.crewUserId !== access.userId) throw new Error("Sólo el propio integrante puede acusar el AST del permiso.")
    if (row.crew.acknowledgedAt) throw new Error("Este integrante ya acusó el permiso.")

    const now = nowIso()
    const signature = createHash("sha256").update(JSON.stringify({
      crewId: row.crew.id, permitId: row.permit.id, userId: access.userId, acknowledgedAt: now,
    })).digest("hex")
    const [updated] = await tx.update(preventionPermitCrew).set({
      acknowledgedAt: now,
      acknowledgementSha256: signature,
      acknowledgementChannel: "account",
    }).where(and(eq(preventionPermitCrew.id, row.crew.id), sql`${preventionPermitCrew.acknowledgedAt} IS NULL`)).returning()
    if (!updated) throw new Error("Este integrante ya acusó el permiso.")
    return updated
  })
}

/**
 * `PER-002` (auditoría 2026-09-14): acuse del AST **sin cuenta de usuario**.
 *
 * `acknowledgePermitCrew` exigía `row.crewUserId === access.userId`. Como el
 * acuse de la cuadrilla es además un bloqueador configurable de la activación
 * (`PER-001`), un tipo de permiso que lo exigiera era inactivable para
 * cualquier cuadrilla sin cuentas: el respaldo del briefing quedaba en papel o
 * el permiso no arrancaba.
 *
 * La vía alternativa es la misma que ya usan PPA y TAE: un enlace-capacidad
 * con token HMAC derivado del id del integrante. Abre exactamente una fila de
 * cuadrilla, así que sigue siendo cierto que nadie acusa por otra persona.
 *
 * QUEDA POR DECIDIR (producto): si el acuse por enlace debe valer lo mismo que
 * el acuse con cuenta para levantar el bloqueador `crew_ack_missing`. Aquí vale
 * —el bloqueador pregunta por `acknowledgedAt`, y negárselo dejaría el permiso
 * igual de inactivable que antes—, y el canal queda registrado para que la
 * política pueda endurecerse sin migrar datos.
 */
export async function acknowledgePermitCrewByPublicToken(
  input: { crewId: string; token: string },
  context: { ip?: string | null; userAgent?: string | null } = {},
) {
  const crewId = String(input.crewId ?? "")
  if (!crewId || !verifyPreventionAckToken("permiso", crewId, input.token)) throw new Error(NOT_FOUND)

  return db.transaction(async (tx) => {
    const [row] = await tx.select({
      crew: preventionPermitCrew,
      permit: preventionWorkPermits,
    })
      .from(preventionPermitCrew)
      .innerJoin(preventionWorkPermits, eq(preventionPermitCrew.permitId, preventionWorkPermits.id))
      .where(eq(preventionPermitCrew.id, crewId)).limit(1)
    if (!row) throw new Error(NOT_FOUND)
    if (row.crew.acknowledgedAt) throw new Error("Este integrante ya acusó el permiso.")

    const now = nowIso()
    const signature = createHash("sha256").update(JSON.stringify({
      crewId: row.crew.id, permitId: row.permit.id, userId: null, channel: "public_token", acknowledgedAt: now,
    })).digest("hex")
    const [updated] = await tx.update(preventionPermitCrew).set({
      acknowledgedAt: now,
      acknowledgementSha256: signature,
      acknowledgementChannel: "public_token",
      acknowledgementIp: context.ip ?? null,
      acknowledgementUserAgent: context.userAgent ?? null,
    }).where(and(eq(preventionPermitCrew.id, row.crew.id), sql`${preventionPermitCrew.acknowledgedAt} IS NULL`)).returning()
    if (!updated) throw new Error("Este integrante ya acusó el permiso.")
    return updated
  })
}

/** Suspende automáticamente los permisos vigentes cuya ventana ya venció. */
export async function suspendExpiredPermits() {
  const now = nowIso()
  const candidates = await db.select().from(preventionWorkPermits)
    .where(inArray(preventionWorkPermits.status, ["active", "approved"]))
  const expired = candidates.filter((permit) => isPermitExpired(permit, now))
  if (expired.length === 0) return { suspended: 0 }

  for (const permit of expired) {
    await db.transaction(async (tx) => {
      const [updated] = await tx.update(preventionWorkPermits).set({
        status: "suspended",
        suspendedAt: now,
        // NULL = suspensión del sistema, no de una persona. Atribuírsela al
        // supervisor falsearía el registro: él no ejecutó el acto. El FK es
        // `onDelete: "restrict"`, así que NULL nunca puede significar "usuario
        // borrado" — acá es inequívoco. Si algún día aparece un tercer tipo de
        // actor (integración externa, mandante), migrar al discriminador
        // `actorType` que ya usa `ppa.ts:98`.
        suspendedByUserId: null,
        suspensionReason: "Suspensión automática: la ventana autorizada del permiso venció.",
        version: permit.version + 1,
        updatedAt: now,
      }).where(and(eq(preventionWorkPermits.id, permit.id), eq(preventionWorkPermits.version, permit.version))).returning()
      if (updated) {
        await history(tx, { permitId: permit.id, changeType: "status", fromStatus: permit.status, toStatus: "suspended", reason: "Vigencia del permiso vencida", actorUserId: null })
      }
    })
  }
  return { suspended: expired.length }
}

/* ── Consultas ────────────────────────────────────────────────────────────── */

export async function listWorkPermits(access: PermitAccess) {
  requireAccess(access, "prevention:permits:view")
  return db.select({
    permit: preventionWorkPermits,
    typeName: preventionPermitTypes.name,
    typeCode: preventionPermitTypes.code,
    worksiteName: worksites.name,
    crewCount: sql<number>`(SELECT COUNT(*)::int FROM prevention_permit_crew c WHERE c.permit_id = ${preventionWorkPermits.id})`,
    acknowledgedCount: sql<number>`(SELECT COUNT(*)::int FROM prevention_permit_crew c WHERE c.permit_id = ${preventionWorkPermits.id} AND c.acknowledged_at IS NOT NULL)`,
    openIsolationCount: sql<number>`(SELECT COUNT(*)::int FROM prevention_permit_isolations i WHERE i.permit_id = ${preventionWorkPermits.id} AND i.applied_at IS NOT NULL AND i.removed_at IS NULL)`,
  })
    .from(preventionWorkPermits)
    .innerJoin(preventionPermitTypes, eq(preventionWorkPermits.permitTypeId, preventionPermitTypes.id))
    .innerJoin(worksites, eq(preventionWorkPermits.worksiteId, worksites.id))
    .where(scopeCondition(access.scope, preventionWorkPermits.worksiteId))
    .orderBy(desc(preventionWorkPermits.plannedStartAt))
    .limit(500)
}

export async function getWorkPermitDetail(permitId: string, access: PermitAccess) {
  requireAccess(access, "prevention:permits:view")
  const supervisor = alias(users, "permit_supervisor")
  const requester = alias(users, "permit_requester")
  const [permit] = await db.select({
    permit: preventionWorkPermits,
    typeName: preventionPermitTypes.name,
    typeCode: preventionPermitTypes.code,
    requiresIsolation: preventionPermitTypes.requiresIsolation,
    requiresMeasurement: preventionPermitTypes.requiresMeasurement,
    requiresJsa: preventionPermitTypes.requiresJsa,
    requiresCrewAcknowledgement: preventionPermitTypes.requiresCrewAcknowledgement,
    measurementValidityMinutes: preventionPermitTypes.measurementValidityMinutes,
    maxDurationHours: preventionPermitTypes.maxDurationHours,
    competencyTaskKey: preventionPermitTypes.competencyTaskKey,
    worksiteName: worksites.name,
    supervisorName: supervisor.name,
    requesterName: requester.name,
  })
    .from(preventionWorkPermits)
    .innerJoin(preventionPermitTypes, eq(preventionWorkPermits.permitTypeId, preventionPermitTypes.id))
    .innerJoin(worksites, eq(preventionWorkPermits.worksiteId, worksites.id))
    .innerJoin(supervisor, eq(preventionWorkPermits.supervisorUserId, supervisor.id))
    .innerJoin(requester, eq(preventionWorkPermits.requestedByUserId, requester.id))
    .where(eq(preventionWorkPermits.id, permitId)).limit(1)
  if (!permit || !scopeAllows(access.scope, permit.permit.worksiteId)) return null

  const [controls, isolations, measurements, jsaSteps, crewRows] = await Promise.all([
    db.select().from(preventionPermitControls).where(eq(preventionPermitControls.permitId, permitId)),
    db.select().from(preventionPermitIsolations).where(eq(preventionPermitIsolations.permitId, permitId)),
    db.select().from(preventionPermitMeasurements).where(eq(preventionPermitMeasurements.permitId, permitId)).orderBy(desc(preventionPermitMeasurements.takenAt)),
    db.select().from(preventionJsaSteps).where(eq(preventionJsaSteps.permitId, permitId)).orderBy(asc(preventionJsaSteps.stepOrder)),
    // Consulta propia y no `resolveCrewEligibility`: la vista de detalle necesita
    // rol, acuse y el usuario ligado a cada integrante (para el botón de acuse
    // propio), que esa función no trae porque sólo la usa la evaluación de
    // habilitación.
    db.select({
      id: preventionPermitCrew.id,
      workerId: preventionPermitCrew.workerId,
      role: preventionPermitCrew.role,
      acknowledgedAt: preventionPermitCrew.acknowledgedAt,
      workerFirstName: workers.firstName,
      workerLastName: workers.lastName,
      crewUserId: users.id,
    })
      .from(preventionPermitCrew)
      .innerJoin(workers, eq(preventionPermitCrew.workerId, workers.id))
      .leftJoin(users, eq(users.workerId, preventionPermitCrew.workerId))
      .where(eq(preventionPermitCrew.permitId, permitId))
      .orderBy(asc(workers.lastName)),
  ])

  return { ...permit, controls, isolations, measurements, jsaSteps, crew: crewRows }
}

export async function listPermitTypes(access: PermitAccess) {
  requireAccess(access, "prevention:permits:view")
  return db.select().from(preventionPermitTypes).orderBy(asc(preventionPermitTypes.code))
}

/** Faenas visibles para el alcance, para poblar el formulario de alta. */
export async function listPermitWorksites(access: PermitAccess) {
  requireAccess(access, "prevention:permits:view")
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
 * Dotación activa dentro del alcance, para armar la cuadrilla.
 *
 * Devuelve `worksiteId` porque el servicio rechaza asignar a alguien de otra
 * faena a la cuadrilla: el formulario filtra por la faena elegida y así el
 * rechazo no aparece recién al enviar.
 */
export async function listPermitWorkers(access: PermitAccess) {
  requireAccess(access, "prevention:permits:view")
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

/**
 * Candidatos a supervisor del permiso: personas habilitadas para verificar
 * controles en terreno. El servicio no restringe `supervisorUserId` a la faena
 * del permiso, así que esta lista tampoco lo hace.
 */
export async function listPermitSupervisors(access: PermitAccess) {
  requireAccess(access, "prevention:permits:view")
  const ids = await getUserIdsWithPermission("prevention:permits:verify")
  if (ids.length === 0) return []
  return db.select({ id: users.id, name: users.name })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.isActive, true)))
    .orderBy(asc(users.name))
}
