import { eq, and, isNull, desc, ne, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { itMaintenances, itAssets, itAssetHistory, itAssetAssignments, suppliers, users, worksites } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { appendAssetHistory } from "./history"
import { assertTiWorksiteAccess, type TiWorksiteScope } from "./scope"
import { escapeLikePattern, formatDate, formatCLP } from "@/lib/utils"
import { IT_MAINTENANCE_TYPE_META, isRetiredStatus } from "./constants"

/** Etiqueta en español del tipo para el historial: nunca el enum crudo. */
const typeLabel = (type: string) => (IT_MAINTENANCE_TYPE_META[type] ?? type).toLowerCase()


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

type MaintenanceTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Efecto único de una reparación: el activo sale de servicio. Se usa al crear
 * y al editar el tipo a `reparacion`, para que ambos caminos se comporten
 * igual. Solo aplica desde `disponible`/`en_bodega`; un activo en custodia se
 * mueve con la salida a reparación (`kind: repair_exit`), que deja acta.
 */
async function moveAssetToRepair(
  tx: MaintenanceTx,
  input: { assetId: string; from: string; maintenanceId: string; detail: string; reason: string },
  actor: { userId: string },
): Promise<void> {
  await tx.update(itAssets).set({
    status: "en_reparacion",
    workerId: null,
    updatedAt: new Date().toISOString(),
  }).where(eq(itAssets.id, input.assetId))
  await appendAssetHistory({
    assetId: input.assetId,
    action: "status_changed",
    detail: input.detail,
    changes: { from: input.from, to: "en_reparacion", maintenanceId: input.maintenanceId },
    actorUserId: actor.userId,
  }, tx)
  await recordStatusChange({
    entityType: "it_asset",
    entityId: input.assetId,
    fromStatus: input.from,
    toStatus: "en_reparacion",
    changedBy: actor.userId,
    reason: input.reason,
  }, tx)
}

export async function createMaintenance(
  input: CreateMaintenanceInput,
  actor: { userId: string; userEmail?: string },
  worksiteIds: TiWorksiteScope = "all",
): Promise<string> {
  const id = nanoid()
  await db.transaction(async (tx) => {
    const [asset] = await tx.select({ id: itAssets.id, code: itAssets.code, worksiteId: itAssets.worksiteId, status: itAssets.status })
      .from(itAssets)
      .where(and(eq(itAssets.id, input.assetId), isNull(itAssets.deletedAt))).for("update")
    if (!asset) throw new Error("Activo no encontrado")
    assertTiWorksiteAccess(worksiteIds, asset.worksiteId)
    // La ficha esconde el botón, pero la baja puede ocurrir en otra pestaña con
    // el formulario ya abierto. Una mantención sobre un activo vendido no
    // aparece en el inventario para corregirla y suma en el gasto anual.
    if (isRetiredStatus(asset.status)) {
      throw new Error("El activo está dado de baja: no admite mantenciones")
    }

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

    // Registrar una reparación es la señal de que el equipo salió de servicio.
    // Solo se mueve si está disponible o en bodega: si está en custodia, el
    // camino correcto es la salida a reparación (`kind: repair_exit`), que deja
    // el acta y la trazabilidad del custodio.
    if (input.type === "reparacion" && (asset.status === "disponible" || asset.status === "en_bodega")) {
      await moveAssetToRepair(tx, {
        assetId: input.assetId,
        from: asset.status,
        maintenanceId: id,
        detail: `Estado: ${asset.status} → En reparación (mantención registrada).`,
        reason: "Mantención de reparación registrada",
      }, actor)
    }

    await appendAssetHistory({
      assetId: input.assetId,
      action: "maintenance",
      detail: `Mantención ${typeLabel(input.type)} registrada (${formatDate(input.date)}).`,
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

    const [asset] = await tx.select({ worksiteId: itAssets.worksiteId, status: itAssets.status })
      .from(itAssets)
      .where(and(eq(itAssets.id, existing.assetId), isNull(itAssets.deletedAt))).for("update")
    if (!asset) throw new Error("Activo no encontrado")
    assertTiWorksiteAccess(worksiteIds, asset.worksiteId)
    if (isRetiredStatus(asset.status)) {
      throw new Error("El activo está dado de baja: no admite mantenciones")
    }

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

    // Editar una mantención a «reparación» debe comportarse como crearla.
    if (
      input.type === "reparacion" &&
      existing.type !== "reparacion" &&
      (asset.status === "disponible" || asset.status === "en_bodega")
    ) {
      await moveAssetToRepair(tx, {
        assetId: existing.assetId,
        from: asset.status,
        maintenanceId: input.id,
        detail: `Estado: ${asset.status} → En reparación (mantención editada a reparación).`,
        reason: "Mantención editada a reparación",
      }, actor)
    }

    await appendAssetHistory({
      assetId: existing.assetId,
      action: "maintenance",
      detail: `Mantención ${typeLabel(input.type)} actualizada (${formatDate(input.date)}).`,
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
 * Anula una mantención mal ingresada. Excluye la fila de los agregados de
 * costo (ver `maintenanceCostByAsset` y los consumidores en `queries.ts`/
 * `reportes/actions.ts`) y la deja visible en `listMaintenances`, tachada.
 *
 * Una `reparacion` sí tiene efecto secundario: al crearla (o al editar el tipo
 * a reparación) el activo pasa a `en_reparacion`. Anular la mantención que lo
 * movió lo devuelve a su estado anterior (`disponible`/`en_bodega`) solo si no
 * queda otra reparación vigente ni una salida a reparación abierta; el
 * historial guarda `changes.from` y `maintenanceId` para encontrarla.
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

    const [asset] = await tx.select({ worksiteId: itAssets.worksiteId, status: itAssets.status })
      .from(itAssets)
      .where(and(eq(itAssets.id, existing.assetId), isNull(itAssets.deletedAt))).for("update")
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
      detail: `Mantención ${typeLabel(existing.type)} del ${formatDate(existing.date)} anulada (costo descontado: ${formatCLP(existing.cost)}).`,
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

    // La mantención pudo ser la que dejó el activo en «En reparación». Anularla
    // no debe dejar el equipo fuera de servicio para siempre: se devuelve al
    // estado anterior solo si no hay otra reparación vigente ni una salida a
    // reparación abierta. El historial guarda `from` y `maintenanceId`.
    if (asset.status === "en_reparacion") {
      const [repairEntry] = await tx.select({ changes: itAssetHistory.changes })
        .from(itAssetHistory)
        .where(and(
          eq(itAssetHistory.assetId, existing.assetId),
          eq(itAssetHistory.action, "status_changed"),
          sql`${itAssetHistory.changes}::jsonb->>'maintenanceId' = ${id}`,
        ))
        .orderBy(desc(itAssetHistory.createdAt))
        .limit(1)

      let previousStatus: string | null = null
      try {
        const parsed = JSON.parse(repairEntry?.changes ?? "{}") as { from?: unknown }
        previousStatus = typeof parsed.from === "string" ? parsed.from : null
      } catch {
        previousStatus = null
      }

      if (previousStatus === "disponible" || previousStatus === "en_bodega") {
        const [otherRepair] = await tx.select({ id: itMaintenances.id }).from(itMaintenances)
          .where(and(
            eq(itMaintenances.assetId, existing.assetId),
            eq(itMaintenances.type, "reparacion"),
            isNull(itMaintenances.voidedAt),
            ne(itMaintenances.id, id),
          )).limit(1)
        const [openRepairExit] = await tx.select({ id: itAssetAssignments.id }).from(itAssetAssignments)
          .where(and(
            eq(itAssetAssignments.assetId, existing.assetId),
            isNull(itAssetAssignments.returnedAt),
            eq(itAssetAssignments.kind, "repair_exit"),
          )).limit(1)

        if (!otherRepair && !openRepairExit) {
          await tx.update(itAssets).set({ status: previousStatus, updatedAt: now })
            .where(eq(itAssets.id, existing.assetId))
          await appendAssetHistory({
            assetId: existing.assetId,
            action: "status_changed",
            detail: `Estado: En reparación → ${previousStatus} (mantención anulada).`,
            changes: { from: "en_reparacion", to: previousStatus, maintenanceId: id, voided: true },
            actorUserId: actor.userId,
          }, tx)
          await recordStatusChange({
            entityType: "it_asset",
            entityId: existing.assetId,
            fromStatus: "en_reparacion",
            toStatus: previousStatus,
            changedBy: actor.userId,
            reason: "Mantención de reparación anulada",
          }, tx)
        }
      }
    }

    return { assetId: existing.assetId }
  })
}

export async function listMaintenances(filters: {
  assetId?: string
  scope?: SQL
  search?: string
  /** Tipo de mantención (enum). */
  type?: string
  /** Rango civil inclusivo, `YYYY-MM-DD`. */
  from?: string
  to?: string
}) {
  const conditions: SQL[] = [isNull(itAssets.deletedAt)]
  if (filters.assetId) conditions.push(eq(itMaintenances.assetId, filters.assetId))
  if (filters.scope) conditions.push(filters.scope)
  if (filters.search) {
    const like = `%${escapeLikePattern(filters.search.trim())}%`
    conditions.push(sql`(${itMaintenances.workDone} ILIKE ${like} OR ${itMaintenances.reportedIssue} ILIKE ${like})`)
  }
  if (filters.type) conditions.push(eq(itMaintenances.type, filters.type))
  if (filters.from) conditions.push(sql`${itMaintenances.date} >= ${filters.from}`)
  if (filters.to) conditions.push(sql`${itMaintenances.date} <= ${filters.to}`)
  return db
    .select({
      id: itMaintenances.id,
      assetId: itMaintenances.assetId,
      worksiteName: worksites.name,
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
    .leftJoin(worksites, eq(itAssets.worksiteId, worksites.id))
    .leftJoin(suppliers, eq(itMaintenances.supplierId, suppliers.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(itMaintenances.date), desc(itMaintenances.id))
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
      /** Costo de adquisición del equipo: el ranking compara el gasto contra lo que vale. */
      assetCost: sql<number | null>`${itAssets.cost}::float8`,
      count: sql<number>`count(*)::int`,
      lastDate: sql<string | null>`max(${itMaintenances.date})`,
    })
    .from(itMaintenances)
    .innerJoin(itAssets, eq(itMaintenances.assetId, itAssets.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(itMaintenances.assetId, itAssets.code, itAssets.brand, itAssets.model, itAssets.cost)
    .orderBy(desc(sql`coalesce(sum(${itMaintenances.cost}), 0)`))
}
