import { eq, and, isNull, asc, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import {
  itAssets, itAssetTypes, itMaintenances, itTickets,
  itAssetAssignments, workers, worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { appendAssetHistory } from "./history"

export interface CreateAssetInput {
  code: string
  assetTypeId: string
  brand?: string | null
  model?: string | null
  serialNumber?: string | null
  status?: string
  worksiteId?: string | null
  location?: string | null
  purchaseDate?: string | null
  supplierId?: string | null
  purchaseDocType?: string | null
  purchaseDocRef?: string | null
  cost?: number | null
  warrantyEndDate?: string | null
  processor?: string | null
  ram?: string | null
  storage?: string | null
  os?: string | null
  observations?: string | null
}

export interface UpdateAssetInput extends CreateAssetInput {
  id: string
}

function cleanSpecs(input: CreateAssetInput, assetType: { hasSpecs: boolean }) {
  // Los specs técnicos solo aplican a tipos que los declaran (hasSpecs).
  // Un tipo que cambió a hasSpecs=false no arrastra datos huérfanos.
  return assetType.hasSpecs
    ? {
        processor: input.processor?.trim() || null,
        ram: input.ram?.trim() || null,
        storage: input.storage?.trim() || null,
        os: input.os?.trim() || null,
      }
    : { processor: null, ram: null, storage: null, os: null }
}

const textOrNull = (v: string | null | undefined, max = 500) => {
  const t = (v ?? "").trim()
  return t ? t.slice(0, max) : null
}

export async function createAsset(
  input: CreateAssetInput,
  actor: { userId: string; userEmail?: string },
): Promise<string> {
  const id = nanoid()
  await db.transaction(async (tx) => {
    if (input.status && input.status !== "disponible") {
      throw new Error("El estado inicial debe ser disponible; usa el flujo de custodia o cambio de estado")
    }
    const [assetType] = await tx.select().from(itAssetTypes).where(eq(itAssetTypes.id, input.assetTypeId))
    if (!assetType) throw new Error("Tipo de activo no encontrado")
    if (!assetType.isActive) throw new Error("El tipo de activo está inactivo")

    const [duplicated] = await tx.select({ id: itAssets.id }).from(itAssets)
      .where(and(eq(itAssets.code, input.code), isNull(itAssets.deletedAt))).limit(1)
    if (duplicated) throw new Error(`Ya existe un activo con el código ${input.code}`)

    await tx.insert(itAssets).values({
      id,
      code: input.code,
      assetTypeId: input.assetTypeId,
      brand: textOrNull(input.brand, 80),
      model: textOrNull(input.model, 80),
      serialNumber: textOrNull(input.serialNumber, 80),
      status: "disponible",
      worksiteId: input.worksiteId || null,
      location: textOrNull(input.location, 120),
      purchaseDate: input.purchaseDate || null,
      supplierId: input.supplierId || null,
      purchaseDocType: input.purchaseDocType || null,
      purchaseDocRef: textOrNull(input.purchaseDocRef, 80),
      cost: input.cost ?? null,
      warrantyEndDate: input.warrantyEndDate || null,
      ...cleanSpecs(input, assetType),
      observations: textOrNull(input.observations, 500),
    })

    await appendAssetHistory({
      assetId: id,
      action: "created",
      detail: `Activo ${input.code} ingresado al inventario.`,
      changes: { status: "disponible" },
      actorUserId: actor.userId,
    }, tx)
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "create",
      entityType: "it_asset",
      entityId: id,
      entityCode: input.code,
      newState: { code: input.code, assetTypeId: input.assetTypeId, status: "disponible" },
    }, tx)
  })
  return id
}

export async function updateAsset(
  input: UpdateAssetInput,
  actor: { userId: string; userEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(itAssets)
      .where(and(eq(itAssets.id, input.id), isNull(itAssets.deletedAt))).for("update")
    if (!existing) throw new Error("Activo no encontrado")

    const [assetType] = await tx.select().from(itAssetTypes).where(eq(itAssetTypes.id, input.assetTypeId))
    if (!assetType) throw new Error("Tipo de activo no encontrado")

    if (input.code !== existing.code) {
      const [duplicated] = await tx.select({ id: itAssets.id }).from(itAssets)
        .where(and(eq(itAssets.code, input.code), isNull(itAssets.deletedAt), sql`${itAssets.id} <> ${input.id}`)).limit(1)
      if (duplicated) throw new Error(`Ya existe un activo con el código ${input.code}`)
    }

    // El status lo cambia el flujo de asignaciones/bajas; editarlo acá solo
    // ajusta datos maestros. Se conserva el estado actual del activo.
    await tx.update(itAssets).set({
      code: input.code,
      assetTypeId: input.assetTypeId,
      brand: textOrNull(input.brand, 80),
      model: textOrNull(input.model, 80),
      serialNumber: textOrNull(input.serialNumber, 80),
      worksiteId: input.worksiteId || null,
      location: textOrNull(input.location, 120),
      purchaseDate: input.purchaseDate || null,
      supplierId: input.supplierId || null,
      purchaseDocType: input.purchaseDocType || null,
      purchaseDocRef: textOrNull(input.purchaseDocRef, 80),
      cost: input.cost ?? null,
      warrantyEndDate: input.warrantyEndDate || null,
      ...cleanSpecs(input, assetType),
      observations: textOrNull(input.observations, 500),
      updatedAt: new Date().toISOString(),
    }).where(eq(itAssets.id, input.id))

    await appendAssetHistory({
      assetId: input.id,
      action: "edited",
      detail: `Datos del activo ${input.code} actualizados.`,
      changes: {
        from: { brand: existing.brand, model: existing.model, serialNumber: existing.serialNumber, cost: existing.cost, warrantyEndDate: existing.warrantyEndDate },
        to: { brand: input.brand, model: input.model, serialNumber: input.serialNumber, cost: input.cost, warrantyEndDate: input.warrantyEndDate },
      },
      actorUserId: actor.userId,
    }, tx)
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "update",
      entityType: "it_asset",
      entityId: input.id,
      entityCode: input.code,
      oldState: { code: existing.code, brand: existing.brand, model: existing.model },
      newState: { code: input.code, brand: input.brand, model: input.model },
    }, tx)
  })
}

/** Baja lógica: el activo desaparece del inventario activo pero su historial queda intacto. */
export async function softDeleteAsset(
  assetId: string,
  actor: { userId: string; userEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(itAssets)
      .where(and(eq(itAssets.id, assetId), isNull(itAssets.deletedAt))).for("update")
    if (!existing) throw new Error("Activo no encontrado")

    const [openAssignment] = await tx.select({ id: itAssetAssignments.id, code: itAssetAssignments.code })
      .from(itAssetAssignments)
      .where(and(eq(itAssetAssignments.assetId, assetId), sql`${itAssetAssignments.returnedAt} IS NULL`))
      .limit(1)
    if (openAssignment) throw new Error(`El activo tiene la asignación ${openAssignment.code} abierta: devuélvelo antes de eliminarlo`)

    await tx.update(itAssets).set({ deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(itAssets.id, assetId))

    await appendAssetHistory({
      assetId,
      action: "status_changed",
      detail: `Activo ${existing.code} eliminado del inventario (baja lógica). El historial se conserva.`,
      actorUserId: actor.userId,
    }, tx)
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "delete",
      entityType: "it_asset",
      entityId: assetId,
      entityCode: existing.code,
      oldState: { code: existing.code },
      newState: { deletedAt: new Date().toISOString() },
    }, tx)
  })
}

/** Cambio manual de estado (motivo obligatorio). Los flujos de asignación usan su propio camino. */
export async function changeAssetStatus(
  input: { assetId: string; status: string; reason: string },
  actor: { userId: string; userEmail?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(itAssets)
      .where(and(eq(itAssets.id, input.assetId), isNull(itAssets.deletedAt))).for("update")
    if (!existing) throw new Error("Activo no encontrado")

    if (input.status === "asignado") {
      const [openAssignment] = await tx.select({ id: itAssetAssignments.id })
        .from(itAssetAssignments)
        .where(and(eq(itAssetAssignments.assetId, input.assetId), sql`${itAssetAssignments.returnedAt} IS NULL`))
        .limit(1)
      if (!openAssignment) throw new Error("Solo una entrega registrada puede dejar el activo en 'asignado'")
    }

    await tx.update(itAssets).set({
      status: input.status,
      // Un cambio manual a disponible/bodega/reparación no arrastra custodio fantasma.
      workerId: input.status === "asignado" ? existing.workerId : null,
      updatedAt: new Date().toISOString(),
    }).where(eq(itAssets.id, input.assetId))

    await appendAssetHistory({
      assetId: input.assetId,
      action: "status_changed",
      detail: `Cambio de estado: ${existing.status} → ${input.status}.`,
      changes: { from: existing.status, to: input.status, reason: input.reason },
      actorUserId: actor.userId,
    }, tx)
    await recordStatusChange({
      entityType: "it_asset",
      entityId: input.assetId,
      fromStatus: existing.status,
      toStatus: input.status,
      changedBy: actor.userId,
      reason: input.reason,
    }, tx)
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "status_change",
      entityType: "it_asset",
      entityId: input.assetId,
      entityCode: existing.code,
      oldState: { status: existing.status },
      newState: { status: input.status },
      reason: input.reason,
    }, tx)
  })
}

export interface AssetListFilters {
  typeId?: string
  status?: string
  workerId?: string
  worksiteId?: string
  supplierId?: string
  warrantyWindow?: "active" | "expiring_30" | "expiring_60" | "expiring_90" | "expired" | "none"
  maxAgeYears?: number
  search?: string
  scope?: SQL | undefined
  includeRetired?: boolean
}

export async function listAssets(filters: AssetListFilters) {
  const conditions: SQL[] = [isNull(itAssets.deletedAt)]
  if (!filters.includeRetired) {
    conditions.push(sql`${itAssets.status} NOT IN ('dado_de_baja', 'perdido', 'robado')`)
  }
  if (filters.typeId) conditions.push(eq(itAssets.assetTypeId, filters.typeId))
  if (filters.status) conditions.push(eq(itAssets.status, filters.status))
  if (filters.workerId) conditions.push(eq(itAssets.workerId, filters.workerId))
  if (filters.worksiteId) conditions.push(eq(itAssets.worksiteId, filters.worksiteId))
  if (filters.supplierId) conditions.push(eq(itAssets.supplierId, filters.supplierId))
  if (filters.scope) conditions.push(filters.scope)

  const today = sql`current_date::text`
  if (filters.warrantyWindow === "active") conditions.push(sql`${itAssets.warrantyEndDate} IS NOT NULL AND ${itAssets.warrantyEndDate} >= ${today}`)
  if (filters.warrantyWindow === "expiring_30") conditions.push(sql`${itAssets.warrantyEndDate} IS NOT NULL AND ${itAssets.warrantyEndDate} >= ${today} AND ${itAssets.warrantyEndDate} <= (${today}::date + 30)::text`)
  if (filters.warrantyWindow === "expiring_60") conditions.push(sql`${itAssets.warrantyEndDate} IS NOT NULL AND ${itAssets.warrantyEndDate} >= ${today} AND ${itAssets.warrantyEndDate} <= (${today}::date + 60)::text`)
  if (filters.warrantyWindow === "expiring_90") conditions.push(sql`${itAssets.warrantyEndDate} IS NOT NULL AND ${itAssets.warrantyEndDate} >= ${today} AND ${itAssets.warrantyEndDate} <= (${today}::date + 90)::text`)
  if (filters.warrantyWindow === "expired") conditions.push(sql`${itAssets.warrantyEndDate} IS NOT NULL AND ${itAssets.warrantyEndDate} < ${today}`)
  if (filters.warrantyWindow === "none") conditions.push(sql`${itAssets.warrantyEndDate} IS NULL`)
  if (filters.maxAgeYears) conditions.push(sql`${itAssets.purchaseDate} IS NOT NULL AND ${itAssets.purchaseDate} >= (${today}::date - ${filters.maxAgeYears} * interval '1 year')::text`)
  if (filters.search) {
    const like = `%${filters.search}%`
    conditions.push(sql`(${itAssets.code} ILIKE ${like} OR ${itAssets.serialNumber} ILIKE ${like} OR ${itAssets.brand} ILIKE ${like} OR ${itAssets.model} ILIKE ${like})`)
  }

  return db
    .select({
      id: itAssets.id,
      code: itAssets.code,
      brand: itAssets.brand,
      model: itAssets.model,
      serialNumber: itAssets.serialNumber,
      status: itAssets.status,
      workerId: itAssets.workerId,
      worksiteId: itAssets.worksiteId,
      location: itAssets.location,
      purchaseDate: itAssets.purchaseDate,
      warrantyEndDate: itAssets.warrantyEndDate,
      cost: itAssets.cost,
      supplierId: itAssets.supplierId,
      assetTypeId: itAssets.assetTypeId,
      createdAt: itAssets.createdAt,
      typeName: itAssetTypes.name,
      workerName: sql<string>`trim(concat(${workers.firstName}, ' ', ${workers.lastName}))`,
      worksiteName: worksites.name,
      maintenanceCount: sql<number>`(SELECT count(*)::int FROM ${itMaintenances} WHERE ${itMaintenances.assetId} = ${itAssets.id})`,
      maintenanceCost: sql<number>`(SELECT coalesce(sum(${itMaintenances.cost}), 0)::float8 FROM ${itMaintenances} WHERE ${itMaintenances.assetId} = ${itAssets.id})`,
      ticketCount: sql<number>`(SELECT count(*)::int FROM ${itTickets} WHERE ${itTickets.assetId} = ${itAssets.id})`,
    })
    .from(itAssets)
    .innerJoin(itAssetTypes, eq(itAssets.assetTypeId, itAssetTypes.id))
    .leftJoin(workers, eq(itAssets.workerId, workers.id))
    .leftJoin(worksites, eq(itAssets.worksiteId, worksites.id))
    .where(and(...conditions))
    .orderBy(asc(itAssets.code))
}

export async function getAssetById(id: string, scope?: SQL) {
  const conditions: SQL[] = [eq(itAssets.id, id), isNull(itAssets.deletedAt)]
  if (scope) conditions.push(scope)
  const [row] = await db
    .select({
      id: itAssets.id,
      code: itAssets.code,
      brand: itAssets.brand,
      model: itAssets.model,
      serialNumber: itAssets.serialNumber,
      status: itAssets.status,
      workerId: itAssets.workerId,
      worksiteId: itAssets.worksiteId,
      location: itAssets.location,
      purchaseDate: itAssets.purchaseDate,
      supplierId: itAssets.supplierId,
      purchaseDocType: itAssets.purchaseDocType,
      purchaseDocRef: itAssets.purchaseDocRef,
      cost: itAssets.cost,
      warrantyEndDate: itAssets.warrantyEndDate,
      processor: itAssets.processor,
      ram: itAssets.ram,
      storage: itAssets.storage,
      os: itAssets.os,
      observations: itAssets.observations,
      assetTypeId: itAssets.assetTypeId,
      createdAt: itAssets.createdAt,
      updatedAt: itAssets.updatedAt,
      typeName: itAssetTypes.name,
      typeCategory: itAssetTypes.category,
      typeHasSpecs: itAssetTypes.hasSpecs,
      workerName: sql<string>`trim(concat(${workers.firstName}, ' ', ${workers.lastName}))`,
      worksiteName: worksites.name,
      maintenanceCount: sql<number>`(SELECT count(*)::int FROM ${itMaintenances} WHERE ${itMaintenances.assetId} = ${itAssets.id})`,
      maintenanceCost: sql<number>`(SELECT coalesce(sum(${itMaintenances.cost}), 0)::float8 FROM ${itMaintenances} WHERE ${itMaintenances.assetId} = ${itAssets.id})`,
      lastMaintenanceDate: sql<string | null>`(SELECT max(${itMaintenances.date}) FROM ${itMaintenances} WHERE ${itMaintenances.assetId} = ${itAssets.id})`,
      ticketCount: sql<number>`(SELECT count(*)::int FROM ${itTickets} WHERE ${itTickets.assetId} = ${itAssets.id})`,
    })
    .from(itAssets)
    .innerJoin(itAssetTypes, eq(itAssets.assetTypeId, itAssetTypes.id))
    .leftJoin(workers, eq(itAssets.workerId, workers.id))
    .leftJoin(worksites, eq(itAssets.worksiteId, worksites.id))
    .where(and(...conditions))
    .limit(1)
  return row ?? null
}

export async function listAssetOptions(scope?: SQL) {
  const conditions: SQL[] = [
    isNull(itAssets.deletedAt),
    sql`${itAssets.status} NOT IN ('dado_de_baja', 'perdido', 'robado')`,
  ]
  if (scope) conditions.push(scope)
  return db
    .select({
      id: itAssets.id,
      code: itAssets.code,
      brand: itAssets.brand,
      model: itAssets.model,
      status: itAssets.status,
      workerId: itAssets.workerId,
      worksiteId: itAssets.worksiteId,
      typeName: itAssetTypes.name,
    })
    .from(itAssets)
    .innerJoin(itAssetTypes, eq(itAssets.assetTypeId, itAssetTypes.id))
    .where(and(...conditions))
    .orderBy(asc(itAssets.code))
}
