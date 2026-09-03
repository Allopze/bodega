import { eq, and, isNull, desc, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { itMaintenances, itAssets, suppliers, users } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { appendAssetHistory } from "./history"
import { assertTiWorksiteAccess, type TiWorksiteScope } from "./scope"


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

export async function listMaintenances(filters: { assetId?: string; scope?: SQL; search?: string }) {
  const conditions: SQL[] = [isNull(itAssets.deletedAt)]
  if (filters.assetId) conditions.push(eq(itMaintenances.assetId, filters.assetId))
  if (filters.scope) conditions.push(filters.scope)
  if (filters.search) {
    const like = `%${filters.search}%`
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
    })
    .from(itMaintenances)
    .innerJoin(itAssets, eq(itMaintenances.assetId, itAssets.id))
    .leftJoin(suppliers, eq(itMaintenances.supplierId, suppliers.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(itMaintenances.date))
}

/** Resumen de costo por activo: identifica equipos que conviene reemplazar. */
export async function maintenanceCostByAsset(scope?: SQL) {
  const conditions: SQL[] = [isNull(itAssets.deletedAt)]
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
