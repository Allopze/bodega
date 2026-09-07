import { eq, and, isNull, asc, sql, notInArray, type SQL } from "drizzle-orm"
import { IT_RETIRED_STATUSES } from "./constants"
import { db } from "@/db"
import {
  itAssets, itAssetTypes, itMaintenances, itTickets,
  itAssetAssignments, workers, worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { appendAssetHistory } from "./history"
import { assertTiWorksiteAccess, type TiWorksiteScope } from "./scope"
import { MANUAL_ASSET_STATUSES } from "@/lib/validation/ti"
import { todayInChile, escapeLikePattern } from "@/lib/utils"

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

type AssetTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Valida código y número de serie contra TODOS los activos, incluidos los
 * eliminados lógicamente.
 *
 * `it_assets.code` y `serial_number` tienen índice único total, no parcial. Al
 * filtrar por `deleted_at IS NULL` la comprobación no veía al activo borrado,
 * Postgres rechazaba con 23505 y `safeActionMessage` —correctamente— tapaba el
 * SQL con un genérico "Error al crear el activo": el usuario acababa de
 * eliminar ese activo y no tenía forma de saber que el código seguía tomado.
 */
async function assertUniqueIdentifiers(
  tx: AssetTx,
  input: { code: string; serialNumber: string | null; excludeId?: string },
): Promise<void> {
  const notSelf = input.excludeId ? sql`${itAssets.id} <> ${input.excludeId}` : undefined

  const [codeClash] = await tx.select({ deletedAt: itAssets.deletedAt }).from(itAssets)
    .where(and(eq(itAssets.code, input.code), notSelf)).limit(1)
  if (codeClash) {
    throw new Error(codeClash.deletedAt
      ? `El código ${input.code} pertenece a un activo eliminado del inventario. Usa otro código.`
      : `Ya existe un activo con el código ${input.code}`)
  }

  if (!input.serialNumber) return
  const [serialClash] = await tx.select({ code: itAssets.code, deletedAt: itAssets.deletedAt }).from(itAssets)
    .where(and(eq(itAssets.serialNumber, input.serialNumber), notSelf)).limit(1)
  if (serialClash) {
    throw new Error(serialClash.deletedAt
      ? `El número de serie ${input.serialNumber} pertenece a un activo eliminado del inventario (${serialClash.code}).`
      : `El número de serie ${input.serialNumber} ya está registrado en el activo ${serialClash.code}`)
  }
}

export async function createAsset(
  input: CreateAssetInput,
  actor: { userId: string; userEmail?: string },
  worksiteIds: TiWorksiteScope = "all",
): Promise<string> {
  const id = nanoid()
  await db.transaction(async (tx) => {
    if (input.status && input.status !== "disponible") {
      throw new Error("El estado inicial debe ser disponible; usa el flujo de custodia o cambio de estado")
    }
    assertTiWorksiteAccess(worksiteIds, input.worksiteId)
    const [assetType] = await tx.select().from(itAssetTypes).where(eq(itAssetTypes.id, input.assetTypeId))
    if (!assetType) throw new Error("Tipo de activo no encontrado")
    if (!assetType.isActive) throw new Error("El tipo de activo está inactivo")

    await assertUniqueIdentifiers(tx, { code: input.code, serialNumber: textOrNull(input.serialNumber, 80) })

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
  worksiteIds: TiWorksiteScope = "all",
): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(itAssets)
      .where(and(eq(itAssets.id, input.id), isNull(itAssets.deletedAt))).for("update")
    if (!existing) throw new Error("Activo no encontrado")
    assertTiWorksiteAccess(worksiteIds, existing.worksiteId)
    assertTiWorksiteAccess(worksiteIds, input.worksiteId)

    if (existing.worksiteId !== input.worksiteId) {
      const [openAssignment] = await tx.select({ id: itAssetAssignments.id })
        .from(itAssetAssignments)
        .where(and(eq(itAssetAssignments.assetId, input.id), isNull(itAssetAssignments.returnedAt)))
        .limit(1)
      if (openAssignment) throw new Error("No puedes cambiar la faena de un activo con custodia abierta")
    }

    const [assetType] = await tx.select().from(itAssetTypes).where(eq(itAssetTypes.id, input.assetTypeId))
    if (!assetType) throw new Error("Tipo de activo no encontrado")
    // Igual que en el alta: no se puede mover un activo a un tipo desactivado.
    // Solo se exige cuando el tipo cambia, para no bloquear la edición de un
    // activo cuyo tipo se desactivó después de haberlo registrado.
    if (input.assetTypeId !== existing.assetTypeId && !assetType.isActive) {
      throw new Error("El tipo de activo está inactivo")
    }

    await assertUniqueIdentifiers(tx, {
      code: input.code,
      serialNumber: textOrNull(input.serialNumber, 80),
      excludeId: input.id,
    })

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
  worksiteIds: TiWorksiteScope = "all",
): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(itAssets)
      .where(and(eq(itAssets.id, assetId), isNull(itAssets.deletedAt))).for("update")
    if (!existing) throw new Error("Activo no encontrado")
    assertTiWorksiteAccess(worksiteIds, existing.worksiteId)

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
  worksiteIds: TiWorksiteScope = "all",
): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(itAssets)
      .where(and(eq(itAssets.id, input.assetId), isNull(itAssets.deletedAt))).for("update")
    if (!existing) throw new Error("Activo no encontrado")
    assertTiWorksiteAccess(worksiteIds, existing.worksiteId)

    // 'en_prestamo' nace y muere con su acta de entrega (kind: "loan"), igual
    // que 'asignado': no es fijable a mano sin una asignación abierta que lo
    // respalde.
    if (input.status === "asignado" || input.status === "en_prestamo") {
      const [openAssignment] = await tx.select({ id: itAssetAssignments.id, kind: itAssetAssignments.kind })
        .from(itAssetAssignments)
        .where(and(eq(itAssetAssignments.assetId, input.assetId), sql`${itAssetAssignments.returnedAt} IS NULL`))
        .limit(1)
      if (!openAssignment) throw new Error(`Solo una entrega registrada puede dejar el activo en '${input.status}'`)
      if (input.status === "en_prestamo" && openAssignment.kind !== "loan") {
        throw new Error("El activo tiene una entrega abierta, pero no es un préstamo")
      }
    } else if (!(MANUAL_ASSET_STATUSES as readonly string[]).includes(input.status)) {
      throw new Error("El estado debe cambiarse mediante su flujo formal de custodia o baja")
    }

    if (input.status !== "asignado" && input.status !== "en_prestamo") {
      const [openAssignment] = await tx.select({ id: itAssetAssignments.id })
        .from(itAssetAssignments)
        .where(and(eq(itAssetAssignments.assetId, input.assetId), isNull(itAssetAssignments.returnedAt)))
        .limit(1)
      if (openAssignment) throw new Error("Cierra la asignación abierta antes de cambiar el estado del activo")
    }

    await tx.update(itAssets).set({
      status: input.status,
      // Un cambio manual a disponible/bodega/reparación no arrastra custodio fantasma.
      workerId: (input.status === "asignado" || input.status === "en_prestamo") ? existing.workerId : null,
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
  /** Antigüedad máxima: equipos comprados hace N años o menos. */
  maxAgeYears?: number
  /**
   * Antigüedad mínima: equipos comprados hace N años o más. Es la pregunta de
   * renovación que plantean el gráfico de antigüedad y el ranking de costos, y
   * no había forma de responderla desde el inventario.
   */
  minAgeYears?: number
  search?: string
  scope?: SQL | undefined
  includeRetired?: boolean
}

export async function listAssets(filters: AssetListFilters) {
  const conditions: SQL[] = [isNull(itAssets.deletedAt)]
  if (!filters.includeRetired) {
    conditions.push(notInArray(itAssets.status, [...IT_RETIRED_STATUSES]))
  }
  if (filters.typeId) conditions.push(eq(itAssets.assetTypeId, filters.typeId))
  if (filters.status) conditions.push(eq(itAssets.status, filters.status))
  if (filters.workerId) conditions.push(eq(itAssets.workerId, filters.workerId))
  if (filters.worksiteId) conditions.push(eq(itAssets.worksiteId, filters.worksiteId))
  if (filters.supplierId) conditions.push(eq(itAssets.supplierId, filters.supplierId))
  if (filters.scope) conditions.push(filters.scope)

  const today = todayInChile()
  if (filters.warrantyWindow === "active") conditions.push(sql`${itAssets.warrantyEndDate} IS NOT NULL AND ${itAssets.warrantyEndDate} >= ${today}`)
  if (filters.warrantyWindow === "expiring_30") conditions.push(sql`${itAssets.warrantyEndDate} IS NOT NULL AND ${itAssets.warrantyEndDate} >= ${today} AND ${itAssets.warrantyEndDate} <= (${today}::date + 30)::text`)
  if (filters.warrantyWindow === "expiring_60") conditions.push(sql`${itAssets.warrantyEndDate} IS NOT NULL AND ${itAssets.warrantyEndDate} >= ${today} AND ${itAssets.warrantyEndDate} <= (${today}::date + 60)::text`)
  if (filters.warrantyWindow === "expiring_90") conditions.push(sql`${itAssets.warrantyEndDate} IS NOT NULL AND ${itAssets.warrantyEndDate} >= ${today} AND ${itAssets.warrantyEndDate} <= (${today}::date + 90)::text`)
  if (filters.warrantyWindow === "expired") conditions.push(sql`${itAssets.warrantyEndDate} IS NOT NULL AND ${itAssets.warrantyEndDate} < ${today}`)
  if (filters.warrantyWindow === "none") conditions.push(sql`${itAssets.warrantyEndDate} IS NULL`)
  if (filters.maxAgeYears) conditions.push(sql`${itAssets.purchaseDate} IS NOT NULL AND ${itAssets.purchaseDate} >= (${today}::date - ${filters.maxAgeYears} * interval '1 year')::text`)
  if (filters.minAgeYears) conditions.push(sql`${itAssets.purchaseDate} IS NOT NULL AND ${itAssets.purchaseDate} <= (${today}::date - ${filters.minAgeYears} * interval '1 year')::text`)
  if (filters.search) {
    const like = `%${escapeLikePattern(filters.search.trim())}%`
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
      maintenanceCount: sql<number>`(SELECT count(*)::int FROM ${itMaintenances} WHERE ${itMaintenances.assetId} = ${itAssets.id} AND ${itMaintenances.voidedAt} IS NULL)`,
      maintenanceCost: sql<number>`(SELECT coalesce(sum(${itMaintenances.cost}), 0)::float8 FROM ${itMaintenances} WHERE ${itMaintenances.assetId} = ${itAssets.id} AND ${itMaintenances.voidedAt} IS NULL)`,
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
      maintenanceCount: sql<number>`(SELECT count(*)::int FROM ${itMaintenances} WHERE ${itMaintenances.assetId} = ${itAssets.id} AND ${itMaintenances.voidedAt} IS NULL)`,
      maintenanceCost: sql<number>`(SELECT coalesce(sum(${itMaintenances.cost}), 0)::float8 FROM ${itMaintenances} WHERE ${itMaintenances.assetId} = ${itAssets.id} AND ${itMaintenances.voidedAt} IS NULL)`,
      lastMaintenanceDate: sql<string | null>`(SELECT max(${itMaintenances.date}) FROM ${itMaintenances} WHERE ${itMaintenances.assetId} = ${itAssets.id} AND ${itMaintenances.voidedAt} IS NULL)`,
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
    notInArray(itAssets.status, [...IT_RETIRED_STATUSES]),
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
