/**
 * Organización preventiva por faena: qué órgano exige la dotación y cuál está
 * efectivamente constituido.
 *
 * El umbral y las reglas viven en `lib/prevention/cphs-organization.ts` (puro).
 * Acá sólo se consulta la dotación, se registran las designaciones de delegado
 * y se cruza una cosa con la otra.
 */

import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/db"
import {
  preventionCommittees,
  preventionCommitteePrograms,
  preventionWorksiteDelegates,
  safetyIndicatorDenominators,
  workers,
  worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { isMandateExpired } from "@/lib/prevention/cphs"
import {
  assessOrganizationCompliance,
  type OrganizationCompliance,
} from "@/lib/prevention/cphs-organization"
import {
  CPHS_NOT_FOUND,
  cphsScopeCondition,
  nowIso,
  recordGovernanceHistory,
  requireCphsAccess,
  type CphsAccess,
} from "@/lib/services/prevention-cphs-access"
import { todayInChile } from "@/lib/utils"

/** Trabajadores propios activos de la faena. Los de contratistas no cuentan. */
export async function getWorksiteHeadcount(worksiteId: string): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` })
    .from(workers)
    .where(and(eq(workers.worksiteId, worksiteId), eq(workers.isActive, true)))
  return row?.count ?? 0
}

const delegateSchema = z.object({
  worksiteId: z.string().min(1),
  workerId: z.string().min(1),
  designatedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  termEndsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.termEndsOn && value.termEndsOn <= value.designatedOn) {
    ctx.addIssue({ code: "custom", path: ["termEndsOn"], message: "El término del período debe ser posterior a la designación." })
  }
})

export async function designateDelegate(input: unknown, access: CphsAccess) {
  const data = delegateSchema.parse(input)
  requireCphsAccess(access, "prevention:cphs:manage", data.worksiteId)

  return db.transaction(async (tx) => {
    const [worker] = await tx.select().from(workers).where(eq(workers.id, data.workerId)).limit(1)
    if (!worker || !worker.isActive) throw new Error("La persona designada no existe o no está activa.")
    if (worker.worksiteId !== data.worksiteId) {
      throw new Error("El delegado debe pertenecer a la dotación de la faena.")
    }

    const today = todayInChile()
    const expired = await tx.select().from(preventionWorksiteDelegates)
      .where(and(
        eq(preventionWorksiteDelegates.worksiteId, data.worksiteId),
        eq(preventionWorksiteDelegates.status, "active"),
        lt(preventionWorksiteDelegates.termEndsOn, today),
      ))
    for (const previous of expired) {
      const reason = "Período terminado por vencimiento de la fecha registrada."
      const [ended] = await tx.update(preventionWorksiteDelegates).set({
        status: "ended",
        endedReason: reason,
        endedAt: nowIso(),
        version: previous.version + 1,
        updatedAt: nowIso(),
      }).where(and(
        eq(preventionWorksiteDelegates.id, previous.id),
        eq(preventionWorksiteDelegates.status, "active"),
        eq(preventionWorksiteDelegates.version, previous.version),
      )).returning()
      if (!ended) throw new Error("El registro cambió mientras lo editabas. Recarga y reintenta.")
      await recordGovernanceHistory(tx, {
        entityType: "delegate",
        entityId: ended.id,
        worksiteId: ended.worksiteId,
        changeType: "expired",
        reason,
        beforeState: previous,
        afterState: ended,
        actorUserId: access.userId,
      })
    }

    const [existing] = await tx.select({ id: preventionWorksiteDelegates.id })
      .from(preventionWorksiteDelegates)
      .where(and(
        eq(preventionWorksiteDelegates.worksiteId, data.worksiteId),
        eq(preventionWorksiteDelegates.status, "active"),
        or(
          isNull(preventionWorksiteDelegates.termEndsOn),
          gte(preventionWorksiteDelegates.termEndsOn, today),
        ),
      )).limit(1)
    if (existing) throw new Error("La faena ya tiene un delegado vigente. Termina su período antes de designar otro.")

    const [created] = await tx.insert(preventionWorksiteDelegates).values({
      id: `cphsdel-${nanoid()}`,
      worksiteId: data.worksiteId,
      workerId: data.workerId,
      designatedOn: data.designatedOn,
      termEndsOn: data.termEndsOn ?? null,
      createdByUserId: access.userId,
    }).returning()
    if (!created) throw new Error("No se pudo registrar la designación del delegado.")

    await recordGovernanceHistory(tx, {
      entityType: "delegate",
      entityId: created.id,
      worksiteId: data.worksiteId,
      changeType: "designated",
      reason: `Delegado de Seguridad y Salud designado el ${data.designatedOn}`,
      afterState: created,
      actorUserId: access.userId,
    })
    return created
  })
}

const endDelegateSchema = z.object({
  delegateId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(10).max(1000),
})

export async function endDelegate(input: unknown, access: CphsAccess) {
  const data = endDelegateSchema.parse(input)

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(preventionWorksiteDelegates)
      .where(eq(preventionWorksiteDelegates.id, data.delegateId)).limit(1)
    if (!current) throw new Error(CPHS_NOT_FOUND)
    requireCphsAccess(access, "prevention:cphs:manage", current.worksiteId)
    if (current.status !== "active") throw new Error("El período de este delegado ya está terminado.")
    if (current.version !== data.expectedVersion) {
      throw new Error("El registro cambió mientras lo editabas. Recarga y reintenta.")
    }

    const [updated] = await tx.update(preventionWorksiteDelegates).set({
      status: "ended",
      endedReason: data.reason,
      endedAt: nowIso(),
      version: current.version + 1,
      updatedAt: nowIso(),
    }).where(and(
      eq(preventionWorksiteDelegates.id, data.delegateId),
      eq(preventionWorksiteDelegates.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("El registro cambió mientras lo editabas. Recarga y reintenta.")

    await recordGovernanceHistory(tx, {
      entityType: "delegate",
      entityId: updated.id,
      worksiteId: updated.worksiteId,
      changeType: "ended",
      reason: data.reason,
      beforeState: current,
      afterState: updated,
      actorUserId: access.userId,
    })
    return updated
  })
}

export async function listDelegates(access: CphsAccess) {
  requireCphsAccess(access, "prevention:cphs:view")
  const scoped = cphsScopeCondition(access.scope, preventionWorksiteDelegates.worksiteId)

  return db.select({
    delegate: preventionWorksiteDelegates,
    worksiteName: worksites.name,
    workerFirstName: workers.firstName,
    workerLastName: workers.lastName,
    workerPosition: workers.position,
  })
    .from(preventionWorksiteDelegates)
    .innerJoin(worksites, eq(worksites.id, preventionWorksiteDelegates.worksiteId))
    .innerJoin(workers, eq(workers.id, preventionWorksiteDelegates.workerId))
    .where(scoped)
    .orderBy(desc(preventionWorksiteDelegates.designatedOn))
    .limit(500)
}

export interface WorksiteOrganizationSummary {
  worksiteId: string
  worksiteName: string
  worksiteCode: string | null
  headcount: number
  committeeId: string | null
  committeeName: string | null
  mandateEndsOn: string | null
  mandateExpired: boolean
  delegateName: string | null
  compliance: OrganizationCompliance
}

/**
 * Una fila por faena del alcance. Se resuelve en cuatro consultas agregadas en
 * vez de una por faena: la lista completa se pinta de una sola pasada.
 */
export async function listWorksiteOrganizations(access: CphsAccess): Promise<WorksiteOrganizationSummary[]> {
  requireCphsAccess(access, "prevention:cphs:view")
  const scoped = cphsScopeCondition(access.scope, worksites.id)
  const today = todayInChile()

  const worksiteRows = await db.select({ id: worksites.id, name: worksites.name, code: worksites.code })
    .from(worksites)
    .where(scoped ? and(eq(worksites.isActive, true), scoped) : eq(worksites.isActive, true))
    .orderBy(worksites.name)
  if (worksiteRows.length === 0) return []

  const ids = worksiteRows.map((row) => row.id)
  const [headcounts, committeeRows, delegateRows] = await Promise.all([
    db.select({ worksiteId: workers.worksiteId, count: sql<number>`count(*)::int` })
      .from(workers)
      .where(and(inArray(workers.worksiteId, ids), eq(workers.isActive, true)))
      .groupBy(workers.worksiteId),
    db.select({
      id: preventionCommittees.id,
      worksiteId: preventionCommittees.worksiteId,
      name: preventionCommittees.name,
      mandateEndsOn: preventionCommittees.mandateEndsOn,
    })
      .from(preventionCommittees)
      .where(and(inArray(preventionCommittees.worksiteId, ids), eq(preventionCommittees.status, "active"))),
    db.select({
      worksiteId: preventionWorksiteDelegates.worksiteId,
      firstName: workers.firstName,
      lastName: workers.lastName,
    })
      .from(preventionWorksiteDelegates)
      .innerJoin(workers, eq(workers.id, preventionWorksiteDelegates.workerId))
      .where(and(
        inArray(preventionWorksiteDelegates.worksiteId, ids),
        eq(preventionWorksiteDelegates.status, "active"),
        or(
          isNull(preventionWorksiteDelegates.termEndsOn),
          gte(preventionWorksiteDelegates.termEndsOn, today),
        ),
      )),
  ])

  const headcountBy = new Map(headcounts.map((row) => [row.worksiteId, row.count]))
  const committeeBy = new Map(committeeRows.map((row) => [row.worksiteId, row]))
  const delegateBy = new Map(delegateRows.map((row) => [row.worksiteId, row]))

  return worksiteRows.map((worksite) => {
    const headcount = headcountBy.get(worksite.id) ?? 0
    const committee = committeeBy.get(worksite.id)
    const delegate = delegateBy.get(worksite.id)
    const mandateExpired = committee ? isMandateExpired(committee.mandateEndsOn, today) : false

    return {
      worksiteId: worksite.id,
      worksiteName: worksite.name,
      worksiteCode: worksite.code,
      headcount,
      committeeId: committee?.id ?? null,
      committeeName: committee?.name ?? null,
      mandateEndsOn: committee?.mandateEndsOn ?? null,
      mandateExpired,
      delegateName: delegate ? `${delegate.lastName}, ${delegate.firstName}` : null,
      compliance: assessOrganizationCompliance({
        headcount,
        hasActiveCommittee: Boolean(committee) && !mandateExpired,
        hasActiveDelegate: Boolean(delegate),
      }),
    }
  })
}

export interface WorksiteOrganizationStatus {
  worksiteId: string
  worksiteName: string
  headcount: number
  /**
   * Dotación declarada del último período cargado en indicadores. Es un dato
   * distinto de `headcount`, que cuenta filas vivas de `workers`: uno lo carga
   * RRHH por mes y el otro es el padrón actual. Se muestran los dos rotulados
   * en vez de elegir uno en silencio, porque discrepar es señal de algo.
   */
  declaredHeadcount: { year: number; month: number; workerCount: number } | null
  prevencionista: string | null
  committee: { id: string; name: string; mandateEndsOn: string; mandateExpired: boolean; dtRegisteredOn: string | null; dtRegistrationReference: string | null } | null
  program: { id: string; committeeId: string; year: number; status: string } | null
  delegate: { id: string; workerName: string; designatedOn: string; termEndsOn: string | null; version: number } | null
  compliance: OrganizationCompliance
}

/**
 * El estado de la organización preventiva de una faena. Un comité con mandato
 * vencido no cuenta como vigente: la fecha manda por sobre el estado guardado,
 * igual que en `getCommitteeStatus`.
 */
export async function getWorksiteOrganization(worksiteId: string, access: CphsAccess): Promise<WorksiteOrganizationStatus | null> {
  requireCphsAccess(access, "prevention:cphs:view", worksiteId)

  const [worksite] = await db.select({ id: worksites.id, name: worksites.name })
    .from(worksites).where(eq(worksites.id, worksiteId)).limit(1)
  if (!worksite) return null

  const today = todayInChile()
  const [headcount, committeeRows, delegateRows, denominatorRows, prevencionistaRows, programRows] = await Promise.all([
    getWorksiteHeadcount(worksiteId),
    db.select().from(preventionCommittees)
      .where(and(eq(preventionCommittees.worksiteId, worksiteId), eq(preventionCommittees.status, "active")))
      .limit(1),
    db.select({
      delegate: preventionWorksiteDelegates,
      firstName: workers.firstName,
      lastName: workers.lastName,
    })
      .from(preventionWorksiteDelegates)
      .innerJoin(workers, eq(workers.id, preventionWorksiteDelegates.workerId))
      .where(and(
        eq(preventionWorksiteDelegates.worksiteId, worksiteId),
        eq(preventionWorksiteDelegates.status, "active"),
        or(
          isNull(preventionWorksiteDelegates.termEndsOn),
          gte(preventionWorksiteDelegates.termEndsOn, today),
        ),
      ))
      .limit(1),
    db.select({
      year: safetyIndicatorDenominators.year,
      month: safetyIndicatorDenominators.month,
      workerCount: safetyIndicatorDenominators.workerCount,
    })
      .from(safetyIndicatorDenominators)
      .where(eq(safetyIndicatorDenominators.worksiteId, worksiteId))
      .orderBy(desc(safetyIndicatorDenominators.year), desc(safetyIndicatorDenominators.month))
      .limit(1),
    // `workers.prevencionista` es texto libre por persona, no un campo de la
    // faena: se toma el que más se repite en la dotación activa.
    db.select({ name: workers.prevencionista, count: sql<number>`count(*)::int` })
      .from(workers)
      .where(and(eq(workers.worksiteId, worksiteId), eq(workers.isActive, true)))
      .groupBy(workers.prevencionista)
      .orderBy(desc(sql`count(*)`))
      .limit(1),
    db.select({
      id: preventionCommitteePrograms.id,
      committeeId: preventionCommitteePrograms.committeeId,
      year: preventionCommitteePrograms.year,
      status: preventionCommitteePrograms.status,
    })
      .from(preventionCommitteePrograms)
      .innerJoin(preventionCommittees, eq(preventionCommittees.id, preventionCommitteePrograms.committeeId))
      .where(eq(preventionCommittees.worksiteId, worksiteId))
      .orderBy(desc(preventionCommitteePrograms.year), desc(preventionCommitteePrograms.createdAt))
      .limit(1),
  ])

  const committeeRow = committeeRows[0]
  const mandateExpired = committeeRow ? isMandateExpired(committeeRow.mandateEndsOn, today) : false
  const delegateRow = delegateRows[0]

  return {
    worksiteId: worksite.id,
    worksiteName: worksite.name,
    headcount,
    declaredHeadcount: denominatorRows[0] ?? null,
    prevencionista: prevencionistaRows[0]?.name ?? null,
    committee: committeeRow
      ? {
          id: committeeRow.id,
          name: committeeRow.name,
          mandateEndsOn: committeeRow.mandateEndsOn,
          mandateExpired,
          dtRegisteredOn: committeeRow.dtRegisteredOn,
          dtRegistrationReference: committeeRow.dtRegistrationReference,
        }
      : null,
    delegate: delegateRow
      ? {
          id: delegateRow.delegate.id,
          workerName: `${delegateRow.lastName}, ${delegateRow.firstName}`,
          designatedOn: delegateRow.delegate.designatedOn,
          termEndsOn: delegateRow.delegate.termEndsOn,
          version: delegateRow.delegate.version,
        }
      : null,
    program: programRows[0] ?? null,
    compliance: assessOrganizationCompliance({
      headcount,
      hasActiveCommittee: Boolean(committeeRow) && !mandateExpired,
      hasActiveDelegate: Boolean(delegateRow),
    }),
  }
}
