import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { db, type DB, type Tx } from "@/db"
import {
  preventionAccreditationItems,
  preventionAccreditationRequirements,
  preventionContractorCompanies,
  preventionContractorContracts,
  preventionContractorHistory,
  preventionContractorWorkers,
  preventionCoordinationMeetings,
  preventionCoordinationParticipants,
  worksites,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import {
  computeAccreditationGaps,
  contractAccessDecision,
  workerAccessDecision,
  type AccreditationGap,
} from "@/lib/prevention/contractors"
import { createCapaActionWithClient } from "@/lib/services/prevention-capa"
import {
  accreditationRequirementSchema,
  accreditationReviewSchema,
  accreditationSubmissionSchema,
  contractAccessSchema,
  contractStatusSchema,
  contractorCompanySchema,
  contractorContractSchema,
  contractorWorkerSchema,
  coordinationCloseSchema,
  coordinationMeetingSchema,
} from "@/lib/validation/prevention-module/contractors"

type Client = DB | Tx

export interface ContractorAccess {
  userId: string
  scope: WorksiteScope
  permissions: readonly string[]
}

const NOT_FOUND = "Registro de contratistas no encontrado o fuera de alcance."

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

function requireAccess(access: ContractorAccess, permission: string, worksiteId?: string) {
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
  await client.insert(preventionContractorHistory).values({
    id: `pcoh-${nanoid()}`,
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

/* ── Empresas y contratos ─────────────────────────────────────────────────── */

export async function createContractorCompany(input: unknown, access: ContractorAccess) {
  requireAccess(access, "prevention:contractors:manage")
  const data = contractorCompanySchema.parse(input)

  if (data.parentCompanyId) {
    const [parent] = await db.select({ id: preventionContractorCompanies.id })
      .from(preventionContractorCompanies).where(eq(preventionContractorCompanies.id, data.parentCompanyId)).limit(1)
    if (!parent) throw new Error("La empresa mandante indicada no existe.")
  }

  const [created] = await db.insert(preventionContractorCompanies).values({
    id: `cocomp-${nanoid()}`,
    rut: data.rut,
    legalName: data.legalName,
    tradeName: data.tradeName ?? null,
    businessActivity: data.businessActivity ?? null,
    insuranceAdministrator: data.insuranceAdministrator ?? null,
    contactName: data.contactName ?? null,
    contactEmail: data.contactEmail ?? null,
    contactPhone: data.contactPhone ?? null,
    parentCompanyId: data.parentCompanyId ?? null,
    createdByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo registrar la empresa contratista.")
  await history(db, { entityType: "company", entityId: created.id, changeType: "created", reason: `Empresa ${data.legalName} incorporada al registro DS 76`, afterState: created, actorUserId: access.userId })
  return created
}

/**
 * Un contrato nace con el acceso bloqueado. La liberación es un acto explícito
 * que exige que no queden brechas bloqueantes: el DS 76 pone la coordinación y
 * verificación documental antes del ingreso, no después.
 */
export async function createContractorContract(input: unknown, access: ContractorAccess) {
  const data = contractorContractSchema.parse(input)
  requireAccess(access, "prevention:contractors:manage", data.worksiteId)

  const [company] = await db.select().from(preventionContractorCompanies)
    .where(eq(preventionContractorCompanies.id, data.companyId)).limit(1)
  if (!company || !company.isActive) throw new Error("La empresa contratista no existe o está inactiva.")

  const [created] = await db.insert(preventionContractorContracts).values({
    id: `cocont-${nanoid()}`,
    code: data.code,
    companyId: data.companyId,
    worksiteId: data.worksiteId,
    relationship: data.relationship,
    scope: data.scope,
    startsOn: data.startsOn,
    endsOn: data.endsOn ?? null,
    plannedHeadcount: data.plannedHeadcount ?? null,
    status: "draft",
    accessBlocked: true,
    accessBlockReason: "Contrato recién creado: acreditación pendiente de verificación.",
    createdByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo crear el contrato.")
  await history(db, { entityType: "contract", entityId: created.id, worksiteId: data.worksiteId, changeType: "created", reason: `Contrato ${data.code} registrado con acceso bloqueado`, afterState: created, actorUserId: access.userId })
  return created
}

export async function registerContractorWorker(input: unknown, access: ContractorAccess) {
  const data = contractorWorkerSchema.parse(input)
  return db.transaction(async (tx) => {
    const [contract] = await tx.select().from(preventionContractorContracts)
      .where(eq(preventionContractorContracts.id, data.contractId)).limit(1)
    if (!contract) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:contractors:manage", contract.worksiteId)
    if (contract.status === "finished") throw new Error("Un contrato terminado no admite nuevas personas.")

    const [created] = await tx.insert(preventionContractorWorkers).values({
      id: `cowk-${nanoid()}`,
      contractId: data.contractId,
      rut: data.rut,
      firstName: data.firstName,
      lastName: data.lastName,
      position: data.position ?? null,
      shift: data.shift ?? null,
      startsOn: data.startsOn ?? null,
      endsOn: data.endsOn ?? null,
      status: "pending",
      accessBlocked: true,
      createdByUserId: access.userId,
    }).returning()
    if (!created) throw new Error("No se pudo registrar a la persona.")
    await history(tx, { entityType: "contractor_worker", entityId: created.id, worksiteId: contract.worksiteId, changeType: "created", reason: `${data.lastName}, ${data.firstName} incorporado al contrato ${contract.code}`, afterState: created, actorUserId: access.userId })
    return created
  })
}

export async function createAccreditationRequirement(input: unknown, access: ContractorAccess) {
  const data = accreditationRequirementSchema.parse(input)
  requireAccess(access, "prevention:contractors:manage", data.worksiteId ?? undefined)

  const [created] = await db.insert(preventionAccreditationRequirements).values({
    id: `coreq-${nanoid()}`,
    code: data.code,
    name: data.name,
    appliesTo: data.appliesTo,
    worksiteId: data.worksiteId ?? null,
    relationship: data.relationship ?? null,
    enforcement: data.enforcement,
    requiresExpiry: data.requiresExpiry,
    legalBasis: data.legalBasis,
    createdByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo crear el requisito de acreditación.")
  await history(db, { entityType: "requirement", entityId: created.id, worksiteId: data.worksiteId ?? null, changeType: "created", reason: data.legalBasis, afterState: created, actorUserId: access.userId })
  return created
}

/* ── Presentación y revisión de evidencia ─────────────────────────────────── */

export async function submitAccreditationItem(input: unknown, access: ContractorAccess) {
  const data = accreditationSubmissionSchema.parse(input)
  return db.transaction(async (tx) => {
    const [contract] = await tx.select().from(preventionContractorContracts)
      .where(eq(preventionContractorContracts.id, data.contractId)).limit(1)
    if (!contract) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:contractors:submit", contract.worksiteId)

    const [requirement] = await tx.select().from(preventionAccreditationRequirements)
      .where(eq(preventionAccreditationRequirements.id, data.requirementId)).limit(1)
    if (!requirement || !requirement.isActive) throw new Error("El requisito de acreditación no existe o está inactivo.")
    if (requirement.requiresExpiry && !data.expiresOn) {
      throw new Error("Este requisito exige declarar la fecha de vencimiento del documento.")
    }
    if (requirement.appliesTo === "worker" && !data.contractorWorkerId) {
      throw new Error("Este requisito es por persona: indica a qué trabajador corresponde.")
    }
    if (requirement.appliesTo !== "worker" && data.contractorWorkerId) {
      throw new Error("Este requisito es de empresa o contrato: no corresponde a una persona.")
    }
    if (data.contractorWorkerId) {
      const [worker] = await tx.select().from(preventionContractorWorkers)
        .where(and(
          eq(preventionContractorWorkers.id, data.contractorWorkerId),
          eq(preventionContractorWorkers.contractId, data.contractId),
        )).limit(1)
      if (!worker) throw new Error("La persona no pertenece a este contrato.")
    }

    const now = nowIso()
    // Reenviar evidencia reabre el ciclo: vuelve a 'submitted' y limpia la
    // revisión anterior para que nadie herede una aprobación caducada.
    const [saved] = await tx.insert(preventionAccreditationItems).values({
      id: `coitem-${nanoid()}`,
      requirementId: data.requirementId,
      contractId: data.contractId,
      contractorWorkerId: data.contractorWorkerId ?? null,
      status: "submitted",
      documentReference: data.documentReference,
      checksumSha256: data.checksumSha256 ?? null,
      issuedOn: data.issuedOn ?? null,
      expiresOn: data.expiresOn ?? null,
      submittedByUserId: access.userId,
      submittedAt: now,
    }).onConflictDoUpdate({
      target: [preventionAccreditationItems.requirementId, preventionAccreditationItems.contractId, preventionAccreditationItems.contractorWorkerId],
      set: {
        status: "submitted",
        documentReference: data.documentReference,
        checksumSha256: data.checksumSha256 ?? null,
        issuedOn: data.issuedOn ?? null,
        expiresOn: data.expiresOn ?? null,
        submittedByUserId: access.userId,
        submittedAt: now,
        reviewedByUserId: null,
        reviewedAt: null,
        observation: null,
        version: sql`${preventionAccreditationItems.version} + 1`,
        updatedAt: now,
      },
    }).returning()
    if (!saved) throw new Error("No se pudo registrar la evidencia.")
    await history(tx, { entityType: "accreditation_item", entityId: saved.id, worksiteId: contract.worksiteId, changeType: "submitted", reason: `Evidencia presentada para ${requirement.code}`, afterState: saved, actorUserId: access.userId })
    return saved
  })
}

/**
 * Revisión segregada: quien presentó la evidencia no puede aprobarla. Es la
 * misma regla de control documental, aplicada al expediente del contratista.
 */
export async function reviewAccreditationItem(input: unknown, access: ContractorAccess) {
  const data = accreditationReviewSchema.parse(input)
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ item: preventionAccreditationItems, worksiteId: preventionContractorContracts.worksiteId })
      .from(preventionAccreditationItems)
      .innerJoin(preventionContractorContracts, eq(preventionAccreditationItems.contractId, preventionContractorContracts.id))
      .where(eq(preventionAccreditationItems.id, data.itemId)).limit(1)
    if (!row) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:contractors:accredit", row.worksiteId)
    if (row.item.version !== data.expectedVersion) throw new Error("La evidencia cambió mientras la revisabas. Recarga y reintenta.")
    if (row.item.status !== "submitted") throw new Error("Sólo puede revisarse una evidencia presentada.")
    if (row.item.submittedByUserId === access.userId) {
      throw new Error("Quien presentó la evidencia no puede aprobarla ni observarla.")
    }

    const now = nowIso()
    const [updated] = await tx.update(preventionAccreditationItems).set({
      status: data.decision,
      observation: data.decision === "observed" ? data.observation : null,
      reviewedByUserId: access.userId,
      reviewedAt: now,
      version: row.item.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionAccreditationItems.id, data.itemId),
      eq(preventionAccreditationItems.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("La evidencia cambió mientras la revisabas. Recarga y reintenta.")
    await history(tx, { entityType: "accreditation_item", entityId: data.itemId, worksiteId: row.worksiteId, changeType: data.decision, reason: data.observation ?? "Evidencia aprobada", beforeState: row.item, afterState: updated, actorUserId: access.userId })
    return updated
  })
}

/* ── Brechas y control de acceso ──────────────────────────────────────────── */

export async function listAccreditationGaps(access: ContractorAccess): Promise<AccreditationGap[]> {
  requireAccess(access, "prevention:contractors:view")
  const contractScope = scopeCondition(access.scope, preventionContractorContracts.worksiteId)

  const contracts = await db.select({
    id: preventionContractorContracts.id,
    code: preventionContractorContracts.code,
    companyId: preventionContractorContracts.companyId,
    worksiteId: preventionContractorContracts.worksiteId,
    relationship: preventionContractorContracts.relationship,
    status: preventionContractorContracts.status,
  }).from(preventionContractorContracts).where(contractScope)

  const contractIds = contracts.map((item) => item.id)
  const [workers, requirements, items] = await Promise.all([
    contractIds.length === 0 ? [] : db.select({
      id: preventionContractorWorkers.id,
      contractId: preventionContractorWorkers.contractId,
      rut: preventionContractorWorkers.rut,
      firstName: preventionContractorWorkers.firstName,
      lastName: preventionContractorWorkers.lastName,
      status: preventionContractorWorkers.status,
    }).from(preventionContractorWorkers).where(inArray(preventionContractorWorkers.contractId, contractIds)),
    db.select({
      id: preventionAccreditationRequirements.id,
      code: preventionAccreditationRequirements.code,
      name: preventionAccreditationRequirements.name,
      appliesTo: preventionAccreditationRequirements.appliesTo,
      worksiteId: preventionAccreditationRequirements.worksiteId,
      relationship: preventionAccreditationRequirements.relationship,
      enforcement: preventionAccreditationRequirements.enforcement,
      isActive: preventionAccreditationRequirements.isActive,
    }).from(preventionAccreditationRequirements).where(eq(preventionAccreditationRequirements.isActive, true)),
    contractIds.length === 0 ? [] : db.select({
      requirementId: preventionAccreditationItems.requirementId,
      contractId: preventionAccreditationItems.contractId,
      contractorWorkerId: preventionAccreditationItems.contractorWorkerId,
      status: preventionAccreditationItems.status,
      expiresOn: preventionAccreditationItems.expiresOn,
    }).from(preventionAccreditationItems).where(inArray(preventionAccreditationItems.contractId, contractIds)),
  ])

  return computeAccreditationGaps({ contracts, workers, requirements, items, asOf: todayInChile() })
}

/**
 * Liberar el acceso de un contrato exige cero brechas bloqueantes de empresa o
 * contrato. No se puede "autorizar igual": la decisión se recalcula contra la
 * evidencia real en el momento de liberar.
 */
export async function releaseContractAccess(input: unknown, access: ContractorAccess) {
  const data = contractAccessSchema.parse(input)
  const [contract] = await db.select().from(preventionContractorContracts)
    .where(eq(preventionContractorContracts.id, data.contractId)).limit(1)
  if (!contract) throw new Error(NOT_FOUND)
  requireAccess(access, "prevention:contractors:authorize_access", contract.worksiteId)
  if (contract.status !== "active") throw new Error("Sólo un contrato vigente puede liberar acceso.")

  const gaps = await listAccreditationGaps(access)
  const decision = contractAccessDecision({ contractId: contract.id, gaps })
  if (!decision.allowed) {
    throw new Error(`No se puede liberar el acceso: quedan ${decision.blockingGaps.length} requisito(s) bloqueante(s) sin aprobar.`)
  }

  return db.transaction(async (tx) => {
    const now = nowIso()
    const [updated] = await tx.update(preventionContractorContracts).set({
      accessBlocked: false,
      accessBlockReason: null,
      accessReleasedByUserId: access.userId,
      accessReleasedAt: now,
      version: contract.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionContractorContracts.id, contract.id),
      eq(preventionContractorContracts.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("El contrato cambió mientras lo editabas. Recarga y reintenta.")

    // Cada persona sin brecha propia queda acreditada en el mismo acto.
    const workers = await tx.select().from(preventionContractorWorkers)
      .where(and(
        eq(preventionContractorWorkers.contractId, contract.id),
        inArray(preventionContractorWorkers.status, ["pending", "accredited"]),
      ))
    for (const worker of workers) {
      const workerDecision = workerAccessDecision({ contractId: contract.id, contractorWorkerId: worker.id, gaps })
      await tx.update(preventionContractorWorkers).set({
        status: workerDecision.allowed ? "accredited" : "pending",
        accessBlocked: !workerDecision.allowed,
        updatedAt: now,
      }).where(eq(preventionContractorWorkers.id, worker.id))
    }

    await history(tx, { entityType: "contract", entityId: contract.id, worksiteId: contract.worksiteId, changeType: "access_released", reason: data.reason, beforeState: contract, afterState: updated, actorUserId: access.userId })
    return updated
  })
}

export async function blockContractAccess(input: unknown, access: ContractorAccess) {
  const data = contractAccessSchema.parse(input)
  const [contract] = await db.select().from(preventionContractorContracts)
    .where(eq(preventionContractorContracts.id, data.contractId)).limit(1)
  if (!contract) throw new Error(NOT_FOUND)
  requireAccess(access, "prevention:contractors:authorize_access", contract.worksiteId)

  return db.transaction(async (tx) => {
    const now = nowIso()
    const [updated] = await tx.update(preventionContractorContracts).set({
      accessBlocked: true,
      accessBlockReason: data.reason,
      accessReleasedByUserId: null,
      accessReleasedAt: null,
      version: contract.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionContractorContracts.id, contract.id),
      eq(preventionContractorContracts.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("El contrato cambió mientras lo editabas. Recarga y reintenta.")
    await tx.update(preventionContractorWorkers)
      .set({ accessBlocked: true, updatedAt: now })
      .where(eq(preventionContractorWorkers.contractId, contract.id))
    await history(tx, { entityType: "contract", entityId: contract.id, worksiteId: contract.worksiteId, changeType: "access_blocked", reason: data.reason, beforeState: contract, afterState: updated, actorUserId: access.userId })
    return updated
  })
}

export async function transitionContractStatus(input: unknown, access: ContractorAccess) {
  const data = contractStatusSchema.parse(input)
  const [contract] = await db.select().from(preventionContractorContracts)
    .where(eq(preventionContractorContracts.id, data.contractId)).limit(1)
  if (!contract) throw new Error(NOT_FOUND)
  requireAccess(access, "prevention:contractors:manage", contract.worksiteId)
  if (contract.version !== data.expectedVersion) throw new Error("El contrato cambió mientras lo editabas. Recarga y reintenta.")

  const allowed: Record<string, string[]> = {
    draft: ["active"],
    active: ["suspended", "finished"],
    suspended: ["active", "finished"],
    finished: [],
  }
  if (!allowed[contract.status]?.includes(data.toStatus)) {
    throw new Error(`No se permite pasar el contrato de ${contract.status} a ${data.toStatus}.`)
  }

  return db.transaction(async (tx) => {
    const now = nowIso()
    // Suspender o terminar corta el acceso en el mismo acto: dejar el contrato
    // cerrado con acceso liberado sería un bypass silencioso.
    const cutsAccess = data.toStatus === "suspended" || data.toStatus === "finished"
    const [updated] = await tx.update(preventionContractorContracts).set({
      status: data.toStatus,
      ...(cutsAccess ? { accessBlocked: true, accessBlockReason: data.reason, accessReleasedByUserId: null, accessReleasedAt: null } : {}),
      version: contract.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionContractorContracts.id, contract.id),
      eq(preventionContractorContracts.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("El contrato cambió mientras lo editabas. Recarga y reintenta.")
    if (cutsAccess) {
      await tx.update(preventionContractorWorkers)
        .set({ accessBlocked: true, updatedAt: now })
        .where(eq(preventionContractorWorkers.contractId, contract.id))
    }
    await history(tx, { entityType: "contract", entityId: contract.id, worksiteId: contract.worksiteId, changeType: data.toStatus, reason: data.reason, beforeState: contract, afterState: updated, actorUserId: access.userId })
    return updated
  })
}

/** Marca vencida la evidencia aprobada cuya fecha ya pasó. Idempotente. */
export async function expireLapsedAccreditations() {
  const today = todayInChile()
  const updated = await db.update(preventionAccreditationItems)
    .set({ status: "expired", updatedAt: nowIso() })
    .where(and(
      eq(preventionAccreditationItems.status, "approved"),
      sql`${preventionAccreditationItems.expiresOn} IS NOT NULL AND ${preventionAccreditationItems.expiresOn} < ${today}`,
    ))
    .returning({ id: preventionAccreditationItems.id, contractId: preventionAccreditationItems.contractId })

  // Un documento vencido re-bloquea el contrato afectado: la habilitación no
  // sobrevive a su propia evidencia.
  const contractIds = [...new Set(updated.map((item) => item.contractId))]
  if (contractIds.length > 0) {
    await db.update(preventionContractorContracts).set({
      accessBlocked: true,
      accessBlockReason: "Evidencia de acreditación vencida.",
      updatedAt: nowIso(),
    }).where(and(
      inArray(preventionContractorContracts.id, contractIds),
      eq(preventionContractorContracts.accessBlocked, false),
    ))
  }
  return { expired: updated.length, blockedContracts: contractIds.length }
}

/* ── Coordinación DS 76 ───────────────────────────────────────────────────── */

export async function createCoordinationMeeting(input: unknown, access: ContractorAccess) {
  const data = coordinationMeetingSchema.parse(input)
  requireAccess(access, "prevention:contractors:coordinate", data.worksiteId)

  return db.transaction(async (tx) => {
    const id = `comeet-${nanoid()}`
    const [created] = await tx.insert(preventionCoordinationMeetings).values({
      id,
      code: `COORD-${new Date().getUTCFullYear()}-${nanoid(8).toUpperCase()}`,
      worksiteId: data.worksiteId,
      heldAt: data.heldAt,
      subject: data.subject,
      agenda: data.agenda,
      attendees: data.attendees,
      riskExchangeSummary: data.riskExchangeSummary ?? null,
      status: "planned",
      createdByUserId: access.userId,
    }).returning()
    if (!created) throw new Error("No se pudo crear la reunión de coordinación.")

    if (data.contractIds.length > 0) {
      const contracts = await tx.select({ id: preventionContractorContracts.id, worksiteId: preventionContractorContracts.worksiteId })
        .from(preventionContractorContracts).where(inArray(preventionContractorContracts.id, data.contractIds))
      const known = new Map(contracts.map((item) => [item.id, item]))
      for (const contractId of data.contractIds) {
        const contract = known.get(contractId)
        if (!contract) throw new Error("Un contrato convocado no existe.")
        if (contract.worksiteId !== data.worksiteId) throw new Error("No se puede convocar a un contrato de otra faena.")
      }
      await tx.insert(preventionCoordinationParticipants).values(data.contractIds.map((contractId) => ({
        id: `copart-${nanoid()}`,
        meetingId: id,
        contractId,
      })))
    }

    await history(tx, { entityType: "coordination_meeting", entityId: id, worksiteId: data.worksiteId, changeType: "created", reason: data.subject, afterState: created, actorUserId: access.userId })
    return created
  })
}

/**
 * Cerrar la reunión exige acta y deriva cada acuerdo a CAPA común. Un acuerdo
 * sin acción trazable es exactamente lo que el DS 76 no acepta como
 * coordinación efectiva.
 */
export async function closeCoordinationMeeting(input: unknown, access: ContractorAccess) {
  const data = coordinationCloseSchema.parse(input)
  return db.transaction(async (tx) => {
    const [meeting] = await tx.select().from(preventionCoordinationMeetings)
      .where(eq(preventionCoordinationMeetings.id, data.meetingId)).limit(1)
    if (!meeting) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:contractors:coordinate", meeting.worksiteId)
    if (meeting.status === "closed") throw new Error("La reunión ya fue cerrada.")
    if (meeting.status === "cancelled") throw new Error("Una reunión cancelada no puede cerrarse.")
    if (meeting.version !== data.expectedVersion) throw new Error("La reunión cambió mientras la editabas. Recarga y reintenta.")

    const now = nowIso()
    if (data.attendedContractIds.length > 0) {
      await tx.update(preventionCoordinationParticipants)
        .set({ attended: true })
        .where(and(
          eq(preventionCoordinationParticipants.meetingId, meeting.id),
          inArray(preventionCoordinationParticipants.contractId, data.attendedContractIds),
        ))
    }

    for (const agreement of data.agreements) {
      await createCapaActionWithClient(tx, {
        sourceType: "contractor",
        sourceId: meeting.id,
        worksiteId: meeting.worksiteId,
        finding: agreement.finding,
        actionDescription: agreement.actionDescription,
        responsibleUserId: agreement.responsibleUserId ?? null,
        responsibleSnapshot: agreement.responsibleSnapshot ?? null,
        priority: agreement.priority,
        targetDate: agreement.targetDate,
        evidenceRequired: true,
      }, access.userId)
    }

    const [updated] = await tx.update(preventionCoordinationMeetings).set({
      status: "closed",
      minutes: data.minutes,
      closedByUserId: access.userId,
      closedAt: now,
      version: meeting.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionCoordinationMeetings.id, meeting.id),
      eq(preventionCoordinationMeetings.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("La reunión cambió mientras la editabas. Recarga y reintenta.")
    await history(tx, { entityType: "coordination_meeting", entityId: meeting.id, worksiteId: meeting.worksiteId, changeType: "closed", reason: `Acta cerrada con ${data.agreements.length} acuerdo(s)`, beforeState: meeting, afterState: updated, actorUserId: access.userId })
    return { meeting: updated, agreementsCreated: data.agreements.length }
  })
}

/* ── Consultas ────────────────────────────────────────────────────────────── */

export async function listContractorContracts(access: ContractorAccess) {
  requireAccess(access, "prevention:contractors:view")
  return db.select({
    contract: preventionContractorContracts,
    companyName: preventionContractorCompanies.legalName,
    companyRut: preventionContractorCompanies.rut,
    worksiteName: worksites.name,
    workerCount: sql<number>`(SELECT COUNT(*)::int FROM prevention_contractor_workers w WHERE w.contract_id = ${preventionContractorContracts.id} AND w.status <> 'withdrawn')`,
    accreditedCount: sql<number>`(SELECT COUNT(*)::int FROM prevention_contractor_workers w WHERE w.contract_id = ${preventionContractorContracts.id} AND w.status = 'accredited')`,
  })
    .from(preventionContractorContracts)
    .innerJoin(preventionContractorCompanies, eq(preventionContractorContracts.companyId, preventionContractorCompanies.id))
    .innerJoin(worksites, eq(preventionContractorContracts.worksiteId, worksites.id))
    .where(scopeCondition(access.scope, preventionContractorContracts.worksiteId))
    .orderBy(desc(preventionContractorContracts.startsOn))
    .limit(500)
}

export async function getContractorContractDetail(contractId: string, access: ContractorAccess) {
  requireAccess(access, "prevention:contractors:view")
  const [contract] = await db.select({
    contract: preventionContractorContracts,
    companyName: preventionContractorCompanies.legalName,
    companyRut: preventionContractorCompanies.rut,
    insuranceAdministrator: preventionContractorCompanies.insuranceAdministrator,
    worksiteName: worksites.name,
  })
    .from(preventionContractorContracts)
    .innerJoin(preventionContractorCompanies, eq(preventionContractorContracts.companyId, preventionContractorCompanies.id))
    .innerJoin(worksites, eq(preventionContractorContracts.worksiteId, worksites.id))
    .where(eq(preventionContractorContracts.id, contractId)).limit(1)
  if (!contract || !scopeAllows(access.scope, contract.contract.worksiteId)) return null

  const [workers, items] = await Promise.all([
    db.select().from(preventionContractorWorkers)
      .where(eq(preventionContractorWorkers.contractId, contractId))
      .orderBy(asc(preventionContractorWorkers.lastName)),
    db.select({
      item: preventionAccreditationItems,
      requirementCode: preventionAccreditationRequirements.code,
      requirementName: preventionAccreditationRequirements.name,
      appliesTo: preventionAccreditationRequirements.appliesTo,
      enforcement: preventionAccreditationRequirements.enforcement,
    })
      .from(preventionAccreditationItems)
      .innerJoin(preventionAccreditationRequirements, eq(preventionAccreditationItems.requirementId, preventionAccreditationRequirements.id))
      .where(eq(preventionAccreditationItems.contractId, contractId)),
  ])
  return { ...contract, workers, items }
}

export async function listAccreditationRequirements(access: ContractorAccess) {
  requireAccess(access, "prevention:contractors:view")
  return db.select({
    requirement: preventionAccreditationRequirements,
    worksiteName: worksites.name,
  })
    .from(preventionAccreditationRequirements)
    .leftJoin(worksites, eq(preventionAccreditationRequirements.worksiteId, worksites.id))
    .orderBy(asc(preventionAccreditationRequirements.code))
}

export async function listCoordinationMeetings(access: ContractorAccess) {
  requireAccess(access, "prevention:contractors:view")
  return db.select({
    meeting: preventionCoordinationMeetings,
    worksiteName: worksites.name,
    convenedCount: sql<number>`(SELECT COUNT(*)::int FROM prevention_coordination_participants p WHERE p.meeting_id = ${preventionCoordinationMeetings.id})`,
    attendedCount: sql<number>`(SELECT COUNT(*)::int FROM prevention_coordination_participants p WHERE p.meeting_id = ${preventionCoordinationMeetings.id} AND p.attended = true)`,
  })
    .from(preventionCoordinationMeetings)
    .innerJoin(worksites, eq(preventionCoordinationMeetings.worksiteId, worksites.id))
    .where(scopeCondition(access.scope, preventionCoordinationMeetings.worksiteId))
    .orderBy(desc(preventionCoordinationMeetings.heldAt))
    .limit(300)
}

export async function listContractorCompanies(access: ContractorAccess) {
  requireAccess(access, "prevention:contractors:view")
  return db.select().from(preventionContractorCompanies)
    .orderBy(asc(preventionContractorCompanies.legalName))
}
