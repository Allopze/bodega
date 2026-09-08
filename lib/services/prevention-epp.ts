import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { z } from "zod"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { db, type DB, type Tx } from "@/db"
import {
  deliveries,
  deliveryItems,
  eppProductFamilies,
  eppTypes,
  preventionCapaActions,
  preventionEppHistory,
  preventionEppRequirements,
  products,
  worksites,
  workers,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { computeEppCoverageGaps, EPP_REQUIREMENT_INPUT_SCOPES, type EppCoverageGap } from "@/lib/prevention/epp"
import { createCapaActionWithClient } from "@/lib/services/prevention-capa"
import { todayInChile } from "@/lib/utils"

type Client = DB | Tx

export interface EppAccess {
  userId: string
  scope: WorksiteScope
  permissions: readonly string[]
}

const NOT_FOUND = "Registro de EPP preventivo no encontrado o fuera de alcance."

function scopeCondition(scope: WorksiteScope, column: AnyPgColumn) {
  if (scope.mode === "all") return undefined
  if (scope.mode === "none" || scope.ids.length === 0) return sql`false`
  return inArray(column, scope.ids)
}

function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

function requireAccess(access: EppAccess, permission: string, worksiteId?: string) {
  if (!access.permissions.includes(permission) || (worksiteId && !scopeAllows(access.scope, worksiteId))) {
    throw new Error(NOT_FOUND)
  }
}

async function history(client: Client, args: {
  entityType: string
  entityId: string
  worksiteId?: string | null
  changeType: string
  reason: string
  afterState?: unknown
  actorUserId?: string | null
}) {
  await client.insert(preventionEppHistory).values({
    id: `peppd-${nanoid()}`,
    entityType: args.entityType,
    entityId: args.entityId,
    worksiteId: args.worksiteId ?? null,
    changeType: args.changeType,
    reason: args.reason,
    afterState: args.afterState ?? null,
    actorUserId: args.actorUserId ?? null,
  })
}

/* ── Requisitos ───────────────────────────────────────────────────────────── */

// Exportado para que createEppRequirementAction (Server Action) pueda
// validar en el boundary con `parseZ` antes de invocar este servicio —
// misma forma, sin duplicar el schema.
export const requirementSchema = z.object({
  eppTypeId: z.string().min(1),
  /**
   * `"task"` NO está: `requirementApplies` lo descarta en su `default`, así que
   * un requisito por tarea se guardaba bien y no generaba brecha para nadie,
   * jamás. La UI lo filtraba, pero el servidor lo aceptaba — un desalineamiento
   * a un `.filter` de distancia de activarse. Se reintroduce cuando el cálculo
   * sepa resolverlo contra la asignación de tareas, no antes.
   */
  scopeType: z.enum(EPP_REQUIREMENT_INPUT_SCOPES),
  scopeValue: z.string().trim().max(300).nullable().optional(),
  worksiteId: z.string().min(1).nullable().optional(),
  enforcement: z.enum(["blocking", "warning"]).default("warning"),
  reason: z.string().trim().min(10).max(2000),
  legalRequirementId: z.string().min(1).nullable().optional(),
  riskEntryId: z.string().min(1).nullable().optional(),
  preferredFamilyId: z.string().min(1).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.scopeType === "position" && !value.scopeValue?.trim()) {
    ctx.addIssue({ code: "custom", path: ["scopeValue"], message: "Un requisito por cargo exige indicar cuál." })
  }
  if (value.scopeType === "worksite" && !value.worksiteId) {
    ctx.addIssue({ code: "custom", path: ["worksiteId"], message: "Un requisito por faena exige indicar la faena." })
  }
})

// Exportado para que escalateBlockingEppGapsAction (Server Action) pueda
// validar en el boundary con `parseZ`. Mismo formato de fecha
// (YYYY-MM-DD) que capaCreateSchema.targetDate en prevention-capa.ts, ya
// que este valor termina ahí (createCapaActionWithClient).
export const escalateBlockingEppGapsSchema = z.object({
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha objetivo inválida"),
})

export async function createEppRequirement(input: unknown, access: EppAccess) {
  const data = requirementSchema.parse(input)
  requireAccess(access, "prevention:epp:manage", data.worksiteId ?? undefined)

  // Fila + historial en la misma transacción: `prevention_epp_history` es el
  // registro inmutable del dominio, y si su insert fallaba tras el de la fila
  // quedaba un cambio de obligatoriedad de EPP sin traza.
  return db.transaction(async (tx) => {
    const [created] = await tx.insert(preventionEppRequirements).values({
      id: `peppr-${nanoid()}`,
      eppTypeId: data.eppTypeId,
      scopeType: data.scopeType,
      scopeValue: data.scopeValue ?? null,
      worksiteId: data.worksiteId ?? null,
      enforcement: data.enforcement,
      reason: data.reason,
      legalRequirementId: data.legalRequirementId ?? null,
      riskEntryId: data.riskEntryId ?? null,
      preferredFamilyId: data.preferredFamilyId ?? null,
      createdByUserId: access.userId,
    }).returning()
    if (!created) throw new Error("No se pudo crear el requisito de EPP.")
    await history(tx, { entityType: "requirement", entityId: created.id, worksiteId: data.worksiteId ?? null, changeType: "created", reason: data.reason, afterState: created, actorUserId: access.userId })
    return created
  })
}

// Exported so the Server Action can validate at the boundary with parseZ
export const updateRequirementSchema = z.object({
  id:                  z.string().min(1),
  enforcement:         z.enum(["blocking", "warning"]).optional(),
  reason:              z.string().trim().min(10).max(2000).optional(),
  preferredFamilyId:   z.string().min(1).nullable().optional(),
  legalRequirementId:  z.string().min(1).nullable().optional(),
  riskEntryId:         z.string().min(1).nullable().optional(),
})

export async function updateEppRequirement(input: unknown, access: EppAccess) {
  const data = updateRequirementSchema.parse(input)
  requireAccess(access, "prevention:epp:manage")

  const existing = await db.query.preventionEppRequirements.findFirst({
    where: eq(preventionEppRequirements.id, data.id),
  })
  if (!existing) throw new Error(NOT_FOUND)
  if (existing.worksiteId) requireAccess(access, "prevention:epp:manage", existing.worksiteId)

  // `updatedAt` es timestamptz: con `todayInChile()` se guardaba "2026-08-17"
  // y se perdía la hora del cambio.
  const patch: Partial<typeof preventionEppRequirements.$inferInsert> = { updatedAt: new Date().toISOString() }
  if (data.enforcement        !== undefined) patch.enforcement        = data.enforcement
  if (data.reason             !== undefined) patch.reason             = data.reason
  if (data.preferredFamilyId  !== undefined) patch.preferredFamilyId  = data.preferredFamilyId
  if (data.legalRequirementId !== undefined) patch.legalRequirementId = data.legalRequirementId
  if (data.riskEntryId        !== undefined) patch.riskEntryId        = data.riskEntryId

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(preventionEppRequirements)
      .set(patch)
      .where(eq(preventionEppRequirements.id, data.id))
      .returning()
    if (!updated) throw new Error("No se pudo actualizar el requisito.")

    await history(tx, {
      entityType:  "requirement",
      entityId:    data.id,
      worksiteId:  existing.worksiteId,
      changeType:  "updated",
      reason:      data.reason ?? existing.reason,
      afterState:  updated,
      actorUserId: access.userId,
    })
    return updated
  })
}

// Exported so the Server Action can validate at the boundary with parseZ
export const deactivateRequirementSchema = z.object({
  id:     z.string().min(1),
  reason: z.string().trim().min(10).max(2000),
})

export async function deactivateEppRequirement(input: unknown, access: EppAccess) {
  const data = deactivateRequirementSchema.parse(input)
  requireAccess(access, "prevention:epp:manage")

  const existing = await db.query.preventionEppRequirements.findFirst({
    where: eq(preventionEppRequirements.id, data.id),
  })
  if (!existing) throw new Error(NOT_FOUND)
  if (existing.worksiteId) requireAccess(access, "prevention:epp:manage", existing.worksiteId)
  if (!existing.isActive) throw new Error("El requisito ya está desactivado.")

  return db.transaction(async (tx) => {
    const [deactivated] = await tx
      .update(preventionEppRequirements)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(and(
        eq(preventionEppRequirements.id, data.id),
        eq(preventionEppRequirements.isActive, true),
      ))
      .returning()
    if (!deactivated) throw new Error("El requisito ya está desactivado.")

    await history(tx, {
      entityType:  "requirement",
      entityId:    data.id,
      worksiteId:  existing.worksiteId,
      changeType:  "deactivated",
      reason:      data.reason,
      afterState:  deactivated,
      actorUserId: access.userId,
    })
    return deactivated
  })
}

/* ── Cobertura y escalamiento ─────────────────────────────────────────────── */

export async function listEppCoverageGaps(
  access: EppAccess,
  options: {
    /**
     * Acota el cálculo a una persona. La hoja de vida de un trabajador pedía
     * las brechas de toda la faena para quedarse con las de uno solo.
     */
    workerId?: string
  } = {},
): Promise<EppCoverageGap[]> {
  requireAccess(access, "prevention:epp:view")
  const workerScope = scopeCondition(access.scope, workers.worksiteId)
  const workerFilter = options.workerId ? eq(workers.id, options.workerId) : undefined

  const [workerRows, requirementRows, deliveryRows] = await Promise.all([
    db.select({ id: workers.id, firstName: workers.firstName, lastName: workers.lastName, position: workers.position, worksiteId: workers.worksiteId, isActive: workers.isActive })
      .from(workers).where(and(eq(workers.isActive, true), workerScope, workerFilter)),
    db.select({
      id: preventionEppRequirements.id,
      eppTypeId: preventionEppRequirements.eppTypeId,
      eppTypeLabel: eppTypes.label,
      scopeType: preventionEppRequirements.scopeType,
      scopeValue: preventionEppRequirements.scopeValue,
      worksiteId: preventionEppRequirements.worksiteId,
      enforcement: preventionEppRequirements.enforcement,
      reason: preventionEppRequirements.reason,
      isActive: preventionEppRequirements.isActive,
    }).from(preventionEppRequirements)
      .innerJoin(eppTypes, eq(preventionEppRequirements.eppTypeId, eppTypes.id))
      .where(eq(preventionEppRequirements.isActive, true)),
    // Sólo entregas nominales a una persona cuentan como cobertura personal;
    // una entrega a faena (destinationType='faena') no acredita a nadie.
    db.select({
      workerId: deliveries.workerId,
      eppTypeId: eppTypes.id,
      deliveredAt: deliveries.deliveredAt,
      lifespanMonths: eppProductFamilies.lifespanMonths,
    }).from(deliveryItems)
      .innerJoin(deliveries, eq(deliveryItems.deliveryId, deliveries.id))
      .innerJoin(workers, eq(deliveries.workerId, workers.id))
      .innerJoin(products, eq(deliveryItems.productId, products.id))
      .innerJoin(eppProductFamilies, eq(products.familyId, eppProductFamilies.id))
      .innerJoin(eppTypes, eq(eppProductFamilies.eppTypeId, eppTypes.id))
      .where(and(
        eq(deliveries.destinationType, "worker"),
        isNotNull(deliveries.workerId),
        // Una entrega anulada no acredita cobertura: dejaba a un trabajador
        // como cubierto por un EPP que la anulación devolvió a bodega. Mismo
        // criterio que el resto de los conteos de entregas (ver
        // `deliveries.voidedAt` en el esquema).
        isNull(deliveries.voidedAt),
        workerScope,
        workerFilter,
      )),
  ])

  return computeEppCoverageGaps({
    workers: workerRows,
    requirements: requirementRows,
    deliveries: deliveryRows.filter((row): row is typeof row & { workerId: string } => row.workerId !== null),
    asOf: todayInChile(),
  })
}

/**
 * Convierte una brecha bloqueante en CAPA trazable. Idempotente por
 * trabajador+tipo de EPP: no abre una segunda acción mientras la primera
 * siga viva. Mismo criterio que `escalateBlockingGapsToCapa` de Capacitación.
 */
export async function escalateBlockingEppGapsToCapa(access: EppAccess, args: { targetDate: string }) {
  requireAccess(access, "prevention:epp:manage")
  const gaps = (await listEppCoverageGaps(access)).filter((gap) => gap.enforcement === "blocking")
  if (gaps.length === 0) return { created: 0, skipped: 0 }

  const sourceIds = gaps.map((gap) => `${gap.workerId}:${gap.eppTypeId}`)

  let created = 0
  let skipped = 0
  await db.transaction(async (tx) => {
    // Dentro de la transacción: ver la nota equivalente en
    // `escalateBlockingGapsToCapa` de capacitación.
    const openActions = await tx.select({ sourceId: preventionCapaActions.sourceId })
      .from(preventionCapaActions)
      .where(and(
        eq(preventionCapaActions.sourceType, "epp"),
        inArray(preventionCapaActions.sourceId, sourceIds),
        sql`${preventionCapaActions.status} NOT IN ('closed', 'cancelled')`,
      ))
    const alreadyOpen = new Set(openActions.map((item) => item.sourceId))

    for (const gap of gaps) {
      const sourceId = `${gap.workerId}:${gap.eppTypeId}`
      if (alreadyOpen.has(sourceId)) { skipped += 1; continue }

      await createCapaActionWithClient(tx, {
        sourceType: "epp",
        sourceId,
        worksiteId: gap.worksiteId,
        finding: `${gap.workerName} no tiene vigente la entrega obligatoria de "${gap.eppTypeLabel}" (${gap.gapType === "expired" ? "vencida" : "nunca entregada"}).`,
        actionDescription: `Entregar "${gap.eppTypeLabel}" a ${gap.workerName} con acuse antes de asignarle tareas que lo exijan.`,
        rootCause: gap.reason,
        priority: "high",
        targetDate: args.targetDate,
        evidenceRequired: true,
      }, access.userId)
      created += 1
    }
  })
  return { created, skipped }
}

/* ── Consultas ────────────────────────────────────────────────────────────── */

export async function listEppRequirements(access: EppAccess) {
  requireAccess(access, "prevention:epp:view")
  // `preferredFamilyId` se guardaba y no se leía en ninguna parte: el hint del
  // formulario ofrece "ayuda a Bodega a saber qué entregar" y no llegaba nada.
  return db.select({
    requirement: preventionEppRequirements,
    eppTypeLabel: eppTypes.label,
    worksiteName: worksites.name,
    preferredFamilyName: eppProductFamilies.canonicalName,
  })
    .from(preventionEppRequirements)
    .innerJoin(eppTypes, eq(preventionEppRequirements.eppTypeId, eppTypes.id))
    .leftJoin(worksites, eq(preventionEppRequirements.worksiteId, worksites.id))
    .leftJoin(eppProductFamilies, eq(preventionEppRequirements.preferredFamilyId, eppProductFamilies.id))
    .orderBy(asc(eppTypes.label))
    .limit(500)
}

/**
 * Completitud del dato sobre el que se calculó la cobertura.
 *
 * Los dos INNER JOIN de `listEppCoverageGaps` descartan sin dejar rastro las
 * entregas de familias sin clasificar, y la pantalla presentaba el resultado
 * como si fuera completo. El sesgo del error es benigno —una familia sin tipo
 * produce brecha de más, no cobertura de menos— pero el usuario no tenía forma
 * de saber sobre qué universo se calculó.
 */
export async function getEppCoverageDataHealth(access: EppAccess) {
  requireAccess(access, "prevention:epp:view")

  const [families, ignoredDeliveries] = await Promise.all([
    db.select({
      total: sql<number>`count(*)::int`,
      unclassified: sql<number>`count(*) filter (where ${eppProductFamilies.eppTypeId} is null)::int`,
    }).from(eppProductFamilies),
    db.select({ count: sql<number>`count(*)::int` })
      .from(deliveryItems)
      .innerJoin(deliveries, eq(deliveryItems.deliveryId, deliveries.id))
      .innerJoin(products, eq(deliveryItems.productId, products.id))
      .leftJoin(eppProductFamilies, eq(products.familyId, eppProductFamilies.id))
      .where(and(
        eq(deliveries.destinationType, "worker"),
        isNull(deliveries.voidedAt),
        eq(products.isEpp, true),
        // Sin familia, o con una familia sin clasificar: en ambos casos la
        // entrega nunca llega a `computeEppCoverageGaps`.
        isNull(eppProductFamilies.eppTypeId),
      )),
  ])

  return {
    totalFamilies:        families[0]?.total ?? 0,
    unclassifiedFamilies: families[0]?.unclassified ?? 0,
    ignoredDeliveries:    ignoredDeliveries[0]?.count ?? 0,
  }
}

/** Catálogo canónico de tipos de EPP, para el selector del requisito. */
export async function listEppTypesForRequirement(access: EppAccess) {
  requireAccess(access, "prevention:epp:view")
  return db.select({ id: eppTypes.id, label: eppTypes.label })
    .from(eppTypes)
    .orderBy(asc(eppTypes.sortOrder))
}

/** Familias de producto EPP ya clasificadas por tipo, para sugerir cuál satisface el requisito. */
export async function listEppProductFamiliesForRequirement(access: EppAccess) {
  requireAccess(access, "prevention:epp:view")
  return db.select({ id: eppProductFamilies.id, name: eppProductFamilies.canonicalName, eppTypeId: eppProductFamilies.eppTypeId })
    .from(eppProductFamilies)
    .where(isNotNull(eppProductFamilies.eppTypeId))
    .orderBy(asc(eppProductFamilies.canonicalName))
}

/** Faenas visibles para el alcance, para crear requisitos por faena. */
export async function listRequirementWorksites(access: EppAccess) {
  requireAccess(access, "prevention:epp:view")
  if (access.scope.mode === "none") return []
  return db.select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(and(
      eq(worksites.isActive, true),
      access.scope.mode === "some" ? inArray(worksites.id, access.scope.ids) : undefined,
    ))
    .orderBy(asc(worksites.name))
}
