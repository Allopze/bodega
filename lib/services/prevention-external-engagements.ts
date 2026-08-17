import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { db, type DB, type Tx } from "@/db"
import {
  preventionCapaActions,
  preventionExternalEngagementHistory,
  preventionExternalEngagements,
  users,
  worksites,
} from "@/db/schema"
import type { WorksiteScope } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import { engagementMeasureKey } from "@/lib/prevention/external-engagements"
import { createCapaActionWithClient } from "@/lib/services/prevention-capa"
import { getUserIdsWithPermission } from "@/lib/services/notification-targeting"
import {
  externalEngagementCloseSchema,
  externalEngagementCreateSchema,
  externalEngagementMeasureSchema,
} from "@/lib/validation/prevention-module/external-engagements"

type Client = DB | Tx

export interface EngagementAccess {
  userId: string
  scope: WorksiteScope
  permissions: readonly string[]
}

const NOT_FOUND = "Interacción externa no encontrada o fuera de alcance."

function scopeAllows(scope: WorksiteScope, worksiteId: string) {
  return scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
}

function requireAccess(access: EngagementAccess, permission: string, worksiteId?: string) {
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
  engagementId: string
  worksiteId: string
  changeType: string
  reason?: string | null
  beforeState?: unknown
  afterState?: unknown
  actorUserId: string
}) {
  await client.insert(preventionExternalEngagementHistory).values({
    id: `pengh-${nanoid()}`,
    engagementId: args.engagementId,
    worksiteId: args.worksiteId,
    changeType: args.changeType,
    reason: args.reason ?? null,
    beforeState: args.beforeState ?? null,
    afterState: args.afterState ?? null,
    actorUserId: args.actorUserId,
  })
}

const CODE_PREFIX: Record<string, string> = {
  coordinacion: "COORD",
  fiscalizacion: "FISC",
  organismo_administrador: "OAL",
}

function createCode(kind: string) {
  return `${CODE_PREFIX[kind] ?? "EXT"}-${nanoid(8).toUpperCase()}`
}

export async function createExternalEngagement(input: unknown, access: EngagementAccess) {
  const data = externalEngagementCreateSchema.parse(input)
  requireAccess(access, "prevention:engagement:manage", data.worksiteId)

  return db.transaction(async (tx) => {
    const [created] = await tx.insert(preventionExternalEngagements).values({
      id: `peng-${nanoid()}`,
      code: createCode(data.kind),
      worksiteId: data.worksiteId,
      kind: data.kind,
      direction: data.direction,
      counterpartyType: data.counterpartyType,
      counterpartyName: data.counterpartyName,
      counterpartyRut: data.counterpartyRut?.trim() || null,
      occurredOn: data.occurredOn,
      subject: data.subject,
      summary: data.summary?.trim() || null,
      outcome: data.outcome?.trim() || null,
      officialReference: data.officialReference?.trim() || null,
      infoTypes: data.infoTypes?.length ? data.infoTypes : null,
      createdByUserId: access.userId,
    }).returning()
    if (!created) throw new Error("No se pudo registrar la interacción externa.")

    await history(tx, {
      engagementId: created.id,
      worksiteId: created.worksiteId,
      changeType: "created",
      afterState: created,
      actorUserId: access.userId,
    })
    return created
  })
}

/**
 * Registra una medida prescrita o un compromiso como acción correctiva.
 *
 * DS 44 art. 70: las medidas que prescribe el organismo administrador son de
 * cumplimiento obligatorio, así que el seguimiento no puede ser una nota — es
 * el estado de una CAPA, con responsable, plazo y verificación.
 *
 * El `sourceItemId` usa la numeración monotónica de la visita, no el índice del
 * arreglo: su índice único junto a `sourceType` hace que reintentar la misma
 * medida no cree una segunda acción.
 */
export async function addPrescribedMeasure(input: unknown, access: EngagementAccess) {
  const data = externalEngagementMeasureSchema.parse(input)

  return db.transaction(async (tx) => {
    const [engagement] = await tx.select().from(preventionExternalEngagements)
      .where(eq(preventionExternalEngagements.id, data.engagementId)).limit(1)
    if (!engagement) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:engagement:manage", engagement.worksiteId)
    if (engagement.closedAt) throw new Error("La interacción ya está cerrada: reábrela para agregar medidas.")

    const [counted] = await tx.select({ count: sql<number>`COUNT(*)::int` })
      .from(preventionCapaActions)
      .where(and(
        eq(preventionCapaActions.sourceType, "external_engagement"),
        eq(preventionCapaActions.sourceId, engagement.id),
      ))

    const capa = await createCapaActionWithClient(tx, {
      sourceType: "external_engagement",
      sourceId: engagement.id,
      sourceItemId: engagementMeasureKey(engagement.id, Number(counted?.count ?? 0) + 1),
      worksiteId: engagement.worksiteId,
      finding: data.finding,
      actionDescription: data.actionDescription,
      responsibleUserId: data.responsibleUserId,
      priority: data.priority,
      targetDate: data.targetDate,
      normativaLegal: data.normativaLegal ?? null,
      sourceRef: { code: engagement.code, kind: engagement.kind, counterparty: engagement.counterpartyName },
    }, access.userId)

    await history(tx, {
      engagementId: engagement.id,
      worksiteId: engagement.worksiteId,
      changeType: "measure_added",
      reason: data.finding,
      afterState: { capaId: capa.id, capaCode: capa.code },
      actorUserId: access.userId,
    })
    return capa
  })
}

export async function closeExternalEngagement(input: unknown, access: EngagementAccess) {
  const data = externalEngagementCloseSchema.parse(input)

  return db.transaction(async (tx) => {
    // `FOR UPDATE`: el gate de medidas abiertas de más abajo se evalúa contra un
    // conteo que `addPrescribedMeasure` puede estar cambiando en paralelo, y sin
    // el lock quedaba una medida prescrita viva bajo una interacción ya cerrada
    // — el estado que ese gate existe para impedir.
    const [engagement] = await tx.select().from(preventionExternalEngagements)
      .where(eq(preventionExternalEngagements.id, data.engagementId)).for("update").limit(1)
    if (!engagement) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:engagement:manage", engagement.worksiteId)
    if (engagement.version !== data.expectedVersion) {
      throw new Error("La interacción cambió mientras la editabas. Recarga y vuelve a intentarlo.")
    }
    if (engagement.closedAt) throw new Error("La interacción ya está cerrada.")

    // Cerrar con medidas prescritas abiertas es exactamente lo que un
    // fiscalizador va a mirar en la visita siguiente.
    const [openRow] = await tx.select({ open: sql<number>`COUNT(*)::int` })
      .from(preventionCapaActions)
      .where(and(
        eq(preventionCapaActions.sourceType, "external_engagement"),
        eq(preventionCapaActions.sourceId, engagement.id),
        sql`${preventionCapaActions.status} NOT IN ('verified', 'closed', 'cancelled')`,
      ))
    const openMeasures = Number(openRow?.open ?? 0)
    if (openMeasures > 0) {
      throw new Error(`No se puede cerrar: quedan ${openMeasures} medida(s) prescrita(s) sin verificar.`)
    }

    const [updated] = await tx.update(preventionExternalEngagements).set({
      outcome: data.outcome,
      closedAt: new Date().toISOString(),
      closedByUserId: access.userId,
      version: sql`${preventionExternalEngagements.version} + 1`,
      updatedAt: new Date().toISOString(),
    }).where(and(
      eq(preventionExternalEngagements.id, engagement.id),
      eq(preventionExternalEngagements.version, data.expectedVersion),
      isNull(preventionExternalEngagements.closedAt),
    )).returning()
    if (!updated) throw new Error("La interacción cambió mientras la editabas. Recarga y vuelve a intentarlo.")

    await history(tx, {
      engagementId: engagement.id,
      worksiteId: engagement.worksiteId,
      changeType: "closed",
      reason: data.outcome,
      beforeState: engagement,
      afterState: updated,
      actorUserId: access.userId,
    })
    return updated
  })
}

export async function listExternalEngagements(access: EngagementAccess, filter: { kind?: string } = {}) {
  requireAccess(access, "prevention:engagement:view")
  return db.select({
    engagement: preventionExternalEngagements,
    worksiteName: worksites.name,
    createdByName: users.name,
    openMeasures: sql<number>`(SELECT COUNT(*)::int FROM prevention_capa_actions c WHERE c.source_type = 'external_engagement' AND c.source_id = ${preventionExternalEngagements.id} AND c.status NOT IN ('verified','closed','cancelled'))`,
    totalMeasures: sql<number>`(SELECT COUNT(*)::int FROM prevention_capa_actions c WHERE c.source_type = 'external_engagement' AND c.source_id = ${preventionExternalEngagements.id})`,
  })
    .from(preventionExternalEngagements)
    .innerJoin(worksites, eq(worksites.id, preventionExternalEngagements.worksiteId))
    .innerJoin(users, eq(users.id, preventionExternalEngagements.createdByUserId))
    .where(and(
      scopeCondition(access.scope, preventionExternalEngagements.worksiteId),
      filter.kind ? eq(preventionExternalEngagements.kind, filter.kind) : undefined,
    ))
    .orderBy(desc(preventionExternalEngagements.occurredOn), desc(preventionExternalEngagements.createdAt))
    .limit(500)
}

/**
 * Detalle de una interacción con sus medidas prescritas.
 *
 * Las medidas son filas de CAPA (`sourceType: 'external_engagement'`), no una
 * tabla propia, así que el detalle las lee de ahí. Es el destino al que apunta
 * `capaSourceHref` cuando se navega desde la acción correctiva hacia su origen.
 */
export async function getExternalEngagement(engagementId: string, access: EngagementAccess) {
  requireAccess(access, "prevention:engagement:view")
  const [row] = await db.select({
    engagement: preventionExternalEngagements,
    worksiteName: worksites.name,
    createdByName: users.name,
  })
    .from(preventionExternalEngagements)
    .innerJoin(worksites, eq(worksites.id, preventionExternalEngagements.worksiteId))
    .innerJoin(users, eq(users.id, preventionExternalEngagements.createdByUserId))
    .where(eq(preventionExternalEngagements.id, engagementId))
    .limit(1)
  if (!row || !scopeAllows(access.scope, row.engagement.worksiteId)) throw new Error(NOT_FOUND)

  const measures = await db.select({
    id: preventionCapaActions.id,
    code: preventionCapaActions.code,
    finding: preventionCapaActions.finding,
    actionDescription: preventionCapaActions.actionDescription,
    status: preventionCapaActions.status,
    priority: preventionCapaActions.priority,
    targetDate: preventionCapaActions.targetDate,
    normativaLegal: preventionCapaActions.normativaLegal,
    responsibleSnapshot: preventionCapaActions.responsibleSnapshot,
  })
    .from(preventionCapaActions)
    .where(and(
      eq(preventionCapaActions.sourceType, "external_engagement"),
      eq(preventionCapaActions.sourceId, engagementId),
    ))
    .orderBy(asc(preventionCapaActions.createdAt))

  return { ...row, measures }
}

/** Faenas donde el usuario puede registrar interacciones. */
export async function listEngagementWorksites(access: EngagementAccess) {
  requireAccess(access, "prevention:engagement:view")
  return db.select({ id: worksites.id, name: worksites.name }).from(worksites)
    .where(and(eq(worksites.isActive, true), scopeCondition(access.scope, worksites.id)))
    .orderBy(asc(worksites.name))
}

/** Candidatos a responsable de una medida prescrita: quien puede cerrar CAPA. */
export async function listEngagementResponsibles(access: EngagementAccess) {
  requireAccess(access, "prevention:engagement:view")
  const ids = await getUserIdsWithPermission("prevention:capa:manage")
  if (ids.length === 0) return []
  return db.select({ id: users.id, name: users.name })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.isActive, true)))
    .orderBy(asc(users.name))
}
