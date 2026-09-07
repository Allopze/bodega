import { eq, and, isNull, desc, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { itMaintenances, itAssets, suppliers, users } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { appendAssetHistory } from "./history"
import { assertTiWorksiteAccess, type TiWorksiteScope } from "./scope"
import { escapeLikePattern } from "@/lib/utils"


export interface CreateMaintenanceInput {
  assetId: string
  type: string
  date: string
  reportedIssue?: string | null
  diagnosis?: string | null
  workDone: string
  partsUsed?: string | null
  supplierId?: string | null
  technicianName?: string | null
  technicianUserId?: string | null
  cost?: number | null
  observations?: string | null
}

const textOrNull = (v: string | null | undefined, max = 500) => {
  const t = (v ?? "").trim()
  return t ? t.slice(0, max) : null
}

export async function createMaintenance(
  input: CreateMaintenanceInput,
  actor: { userId: string; userEmail?: string },
  worksiteIds: TiWorksiteScope = "all",
): Promise<string> {
  const id = nanoid()
  await db.transaction(async (tx) => {
    const [asset] = await tx.select({ id: itAssets.id, code: itAssets.code, worksiteId: itAssets.worksiteId })
      .from(itAssets)
      .where(and(eq(itAssets.id, input.assetId), isNull(itAssets.deletedAt))).for("update")
    if (!asset) throw new Error("Activo no encontrado")
    assertTiWorksiteAccess(worksiteIds, asset.worksiteId)

    await tx.insert(itMaintenances).values({
      id,
      assetId: input.assetId,
      type: input.type,
      date: input.date,
      reportedIssue: textOrNull(input.reportedIssue),
      diagnosis: textOrNull(input.diagnosis),
      workDone: textOrNull(input.workDone, 1000) ?? "",
      partsUsed: textOrNull(input.partsUsed),
      supplierId: input.supplierId || null,
      technicianName: textOrNull(input.technicianName, 80),
      technicianUserId: input.technicianUserId || null,
      cost: input.cost ?? 0,
      observations: textOrNull(input.observations),
    })

    await appendAssetHistory({
      assetId: input.assetId,
      action: "maintenance",
      detail: `Mantención ${input.type} registrada (${input.date}).`,
      changes: { maintenanceId: id, cost: input.cost ?? 0 },
      actorUserId: actor.userId,
    }, tx)
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "create",
      entityType: "it_maintenance",
      entityId: id,
      newState: { assetId: input.assetId, type: input.type, date: input.date, cost: input.cost ?? 0 },
    }, tx)
  })
  return id
}

export async function updateMaintenance(
  input: CreateMaintenanceInput & { id: string },
  actor: { userId: string; userEmail?: string },
  worksiteIds: TiWorksiteScope = "all",
): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(itMaintenances).where(eq(itMaintenances.id, input.id)).for("update")
    if (!existing) throw new Error("Mantención no encontrada")
    if (existing.voidedAt) throw new Error("Esta mantención está anulada: no se puede editar")
    if (input.assetId !== existing.assetId) throw new Error("No se puede cambiar el activo de una mantención existente")

    const [asset] = await tx.select({ worksiteId: itAssets.worksiteId })
      .from(itAssets)
      .where(and(eq(itAssets.id, existing.assetId), isNull(itAssets.deletedAt)))
    if (!asset) throw new Error("Activo no encontrado")
    assertTiWorksiteAccess(worksiteIds, asset.worksiteId)

    await tx.update(itMaintenances).set({
      type: input.type,
      date: input.date,
      reportedIssue: textOrNull(input.reportedIssue),
      diagnosis: textOrNull(input.diagnosis),
      workDone: textOrNull(input.workDone, 1000) ?? "",
      partsUsed: textOrNull(input.partsUsed),
      supplierId: input.supplierId || null,
      technicianName: textOrNull(input.technicianName, 80),
      technicianUserId: input.technicianUserId || null,
      cost: input.cost ?? 0,
      observations: textOrNull(input.observations),
      updatedAt: new Date().toISOString(),
    }).where(eq(itMaintenances.id, input.id))

    await appendAssetHistory({
      assetId: existing.assetId,
      action: "maintenance",
      detail: `Mantención ${input.type} actualizada (${input.date}).`,
      changes: { maintenanceId: input.id, cost: input.cost ?? 0 },
      actorUserId: actor.userId,
    }, tx)
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "update",
      entityType: "it_maintenance",
      entityId: input.id,
      oldState: { cost: existing.cost, date: existing.date, type: existing.type },
      newState: { cost: input.cost ?? 0, date: input.date, type: input.type },
    }, tx)
  })
}

/**
 * Anula una mantención mal ingresada. No hay efecto secundario que revertir
 * en `it_assets`: `createMaintenance`/`updateMaintenance` nunca lo tocan.
 * Solo excluye la fila de los agregados de costo (ver `maintenanceCostByAsset`
 * y los consumidores en `queries.ts`/`reportes/actions.ts`) — la fila sigue
 * apareciendo en `listMaintenances`, tachada, para que la corrección quede
 * visible en vez de desaparecer como un borrado.
 */
export async function voidMaintenance(
  id: string,
  reason: string,
  actor: { userId: string; userEmail?: string },
  worksiteIds: TiWorksiteScope = "all",
): Promise<{ assetId: string }> {
  const trimmed = reason?.trim() ?? ""
  if (trimmed.length < 10) throw new Error("La anulación requiere un motivo de al menos 10 caracteres")

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(itMaintenances).where(eq(itMaintenances.id, id)).for("update")
    if (!existing) throw new Error("Mantención no encontrada")
    if (existing.voidedAt) throw new Error("Esta mantención ya fue anulada")

    const [asset] = await tx.select({ worksiteId: itAssets.worksiteId })
      .from(itAssets)
      .where(and(eq(itAssets.id, existing.assetId), isNull(itAssets.deletedAt)))
    if (!asset) throw new Error("Activo no encontrado")
    assertTiWorksiteAccess(worksiteIds, asset.worksiteId)

    const now = new Date().toISOString()
    await tx.update(itMaintenances).set({
      voidedAt: now,
      voidedByUserId: actor.userId,
      voidReason: trimmed,
      updatedAt: now,
    }).where(and(eq(itMaintenances.id, id), isNull(itMaintenances.voidedAt)))

    await appendAssetHistory({
      assetId: existing.assetId,
      action: "maintenance_voided",
      detail: `Mantención ${existing.type} del ${existing.date} anulada (costo revertido: ${existing.cost}).`,
      changes: { maintenanceId: id, voidReason: trimmed, cost: existing.cost, type: existing.type, date: existing.date },
      actorUserId: actor.userId,
    }, tx)
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "update",
      entityType: "it_maintenance",
      entityId: id,
      oldState: { voidedAt: null, cost: existing.cost, date: existing.date, type: existing.type },
      newState: { voidedAt: now, voidReason: trimmed },
      reason: trimmed,
    }, tx)

    return { assetId: existing.assetId }
  })
}

export async function listMaintenances(filters: { assetId?: string; scope?: SQL; search?: string }) {
  const conditions: SQL[] = [isNull(itAssets.deletedAt)]
  if (filters.assetId) conditions.push(eq(itMaintenances.assetId, filters.assetId))
  if (filters.scope) conditions.push(filters.scope)
  if (filters.search) {
    const like = `%${escapeLikePattern(filters.search.trim())}%`
    conditions.push(sql`(${itMaintenances.workDone} ILIKE ${like} OR ${itMaintenances.reportedIssue} ILIKE ${like})`)
  }
  return db
    .select({
      id: itMaintenances.id,
      assetId: itMaintenances.assetId,
      assetCode: itAssets.code,
      assetBrand: itAssets.brand,
      assetModel: itAssets.model,
      type: itMaintenances.type,
      date: itMaintenances.date,
      reportedIssue: itMaintenances.reportedIssue,
      diagnosis: itMaintenances.diagnosis,
      workDone: itMaintenances.workDone,
      partsUsed: itMaintenances.partsUsed,
      supplierId: itMaintenances.supplierId,
      cost: itMaintenances.cost,
      supplierName: suppliers.name,
      technicianName: itMaintenances.technicianName,
      technicianUserId: itMaintenances.technicianUserId,
      technicianUserName: sql<string>`(SELECT u.name FROM ${users} u WHERE u.id = ${itMaintenances.technicianUserId})`,
      observations: itMaintenances.observations,
      voidedAt: itMaintenances.voidedAt,
      voidReason: itMaintenances.voidReason,
      voidedByUserName: sql<string | null>`(SELECT u.name FROM ${users} u WHERE u.id = ${itMaintenances.voidedByUserId})`,
    })
    .from(itMaintenances)
    .innerJoin(itAssets, eq(itMaintenances.assetId, itAssets.id))
    .leftJoin(suppliers, eq(itMaintenances.supplierId, suppliers.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(itMaintenances.date))
}

/** Resumen de costo por activo: identifica equipos que conviene reemplazar. Excluye anuladas. */
export async function maintenanceCostByAsset(scope?: SQL) {
  const conditions: SQL[] = [isNull(itAssets.deletedAt), isNull(itMaintenances.voidedAt)]
  if (scope) conditions.push(scope)
  return db
    .select({
      assetId: itMaintenances.assetId,
      assetCode: itAssets.code,
      brand: itAssets.brand,
      model: itAssets.model,
      totalCost: sql<number>`coalesce(sum(${itMaintenances.cost}), 0)::float8`,
      count: sql<number>`count(*)::int`,
      lastDate: sql<string | null>`max(${itMaintenances.date})`,
    })
    .from(itMaintenances)
    .innerJoin(itAssets, eq(itMaintenances.assetId, itAssets.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(itMaintenances.assetId, itAssets.code, itAssets.brand, itAssets.model)
    .orderBy(desc(sql`coalesce(sum(${itMaintenances.cost}), 0)`))
}
