import { eq, and, isNull, isNotNull, desc, inArray, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { itAssetRetirements, itAssets, itAssetAssignments, itAssetHistory, users } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit, recordStatusChange } from "@/lib/audit"
import { appendAssetHistory } from "./history"
import { assertTiWorksiteAccess, type TiWorksiteScope } from "./scope"
import { retirementTargetStatus, retirementReverseBlocker, itStatusLabel, isRetiredStatus } from "./constants"

export { retirementTargetStatus }


export interface RetireAssetInput {
  assetId: string
  date: string
  reason: string
  responsibleUserId: string
  authorizedByUserId: string
  destination?: string | null
  observations?: string | null
}


export async function retireAsset(
  input: RetireAssetInput,
  actor: { userId: string; userEmail?: string },
  worksiteIds: TiWorksiteScope = "all",
): Promise<string> {
  const id = nanoid()
  await db.transaction(async (tx) => {
    const [asset] = await tx.select().from(itAssets)
      .where(and(eq(itAssets.id, input.assetId), isNull(itAssets.deletedAt))).for("update")
    if (!asset) throw new Error("Activo no encontrado")
    assertTiWorksiteAccess(worksiteIds, asset.worksiteId)
    if (isRetiredStatus(asset.status)) {
      throw new Error(`El activo ya está en estado '${asset.status}'`)
    }

    // Doble control, revalidado en servidor: el esquema ya lo exige, pero la
    // baja es irreversible y no debe depender solo de la capa de formulario.
    if (input.responsibleUserId === input.authorizedByUserId) {
      throw new Error("Quien autoriza la baja debe ser distinto del responsable")
    }
    const signatories = await tx.select({ id: users.id, isActive: users.isActive })
      .from(users)
      .where(inArray(users.id, [input.responsibleUserId, input.authorizedByUserId]))
    if (signatories.length !== 2) throw new Error("Responsable o autorizante no encontrado")
    if (signatories.some((user) => !user.isActive)) {
      throw new Error("Responsable y autorizante deben ser usuarios activos")
    }

    // Una asignación abierta debe cerrarse antes de dar de baja (custodia clara).
    const openAssignments = await tx.select({ id: itAssetAssignments.id, code: itAssetAssignments.code })
      .from(itAssetAssignments)
      .where(and(eq(itAssetAssignments.assetId, input.assetId), sql`${itAssetAssignments.returnedAt} IS NULL`))
    const openAssignment = openAssignments[0]
    if (openAssignment && !["perdida", "robo"].includes(input.reason)) {
      throw new Error(`El activo tiene la asignación ${openAssignment.code} abierta: devuélvelo antes de dar de baja`)
    }
    // Defensivo: el índice único parcial `it_asset_assignments_active_asset_unique`
    // ya prohíbe más de una asignación abierta por activo — esto es inalcanzable
    // hoy, pero si esa invariante se cayera algún día, la baja debe fallar en
    // vez de cerrar N asignaciones y guardar solo una en `closedAssignmentId`.
    if (openAssignments.length > 1) {
      throw new Error("El activo tiene más de una asignación abierta: corrige la custodia antes de dar de baja")
    }

    const targetStatus = retirementTargetStatus(input.reason)
    const now = new Date().toISOString()
    const reasonLabel = input.reason === "perdida" ? "pérdida" : input.reason
    // Misma condición que decide si se cierra la asignación, extraída para
    // que el insert de abajo (que guarda cuál se cerró) no se desincronice.
    const closedNow = openAssignments.length > 0 && ["perdida", "robo"].includes(input.reason)

    // Pérdida y robo son excepciones a la devolución física, no una segunda
    // forma de mantener una custodia abierta. Se cierra el tramo histórico
    // dejando el motivo en las observaciones para que los indicadores de
    // custodia y las consultas de asignaciones no sigan contando el activo.
    if (closedNow) {
      await tx.update(itAssetAssignments).set({
        returnedAt: now,
        returnedByUserId: actor.userId,
        returnObservations: `Custodia cerrada por ${reasonLabel}.${input.observations?.trim() ? ` ${input.observations.trim()}` : ""}`,
        updatedAt: now,
      }).where(and(eq(itAssetAssignments.assetId, input.assetId), isNull(itAssetAssignments.returnedAt)))
    }

    await tx.insert(itAssetRetirements).values({
      id,
      assetId: input.assetId,
      date: input.date,
      reason: input.reason,
      responsibleUserId: input.responsibleUserId,
      authorizedByUserId: input.authorizedByUserId,
      destination: input.destination?.trim() || null,
      observations: input.observations?.trim() || null,
      // Estado y custodio previos a la baja, para poder revertirla. Y la
      // asignación que esta baja cerró por pérdida/robo, si hubo alguna.
      previousStatus: asset.status,
      previousWorkerId: asset.workerId,
      closedAssignmentId: closedNow ? openAssignment!.id : null,
    })

    await tx.update(itAssets).set({
      status: targetStatus,
      // El activo dado de baja no tiene custodio vigente.
      workerId: null,
      updatedAt: now,
    }).where(eq(itAssets.id, input.assetId))

    await appendAssetHistory({
      assetId: input.assetId,
      action: "retired",
      detail: `Baja de activo (${input.reason}). Fecha: ${input.date}.`,
      changes: { retirementId: id, reason: input.reason, targetStatus },
      actorUserId: actor.userId,
    }, tx)
    await recordStatusChange({
      entityType: "it_asset",
      entityId: input.assetId,
      fromStatus: asset.status,
      toStatus: targetStatus,
      changedBy: actor.userId,
      reason: input.reason,
    }, tx)
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "status_change",
      entityType: "it_asset",
      entityId: input.assetId,
      entityCode: asset.code,
      oldState: { status: asset.status },
      newState: { status: targetStatus, reason: input.reason },
      reason: input.reason,
    }, tx)
  })
  return id
}

export async function listRetirements(filters: { scope?: SQL; assetId?: string }) {
  const conditions: SQL[] = []
  if (filters.scope) conditions.push(filters.scope)
  if (filters.assetId) conditions.push(eq(itAssetRetirements.assetId, filters.assetId))
  const rows = await db
    .select({
      id: itAssetRetirements.id,
      assetId: itAssetRetirements.assetId,
      assetCode: itAssets.code,
      brand: itAssets.brand,
      model: itAssets.model,
      date: itAssetRetirements.date,
      reason: itAssetRetirements.reason,
      destination: itAssetRetirements.destination,
      observations: itAssetRetirements.observations,
      responsibleName: sql<string>`${users.name}`,
      previousStatus: itAssetRetirements.previousStatus,
      closedAssignmentId: itAssetRetirements.closedAssignmentId,
      reversedAt: itAssetRetirements.reversedAt,
      reverseReason: itAssetRetirements.reverseReason,
      reversedByName: sql<string | null>`(SELECT u2.name FROM ${users} u2 WHERE u2.id = ${itAssetRetirements.reversedByUserId})`,
      assetStatus: itAssets.status,
      assetDeletedAt: itAssets.deletedAt,
      // Por (created_at, id), no por `date`: `date` es fecha civil (texto) y
      // dos bajas del mismo día empatarían.
      hasLaterRetirement: sql<boolean>`EXISTS (
        SELECT 1 FROM it_asset_retirements r2
        WHERE r2.asset_id = ${itAssetRetirements.assetId}
          AND (r2.created_at, r2.id) > (${itAssetRetirements.createdAt}, ${itAssetRetirements.id})
      )`,
      hasLaterMovement: sql<boolean>`EXISTS (
        SELECT 1 FROM it_asset_history h
        WHERE h.asset_id = ${itAssetRetirements.assetId}
          AND h.action IN ('status_changed', 'assigned', 'returned')
          AND h.created_at > ${itAssetRetirements.createdAt}
      )`,
      hasOpenAssignment: sql<boolean>`EXISTS (
        SELECT 1 FROM it_asset_assignments asg
        WHERE asg.asset_id = ${itAssetRetirements.assetId} AND asg.returned_at IS NULL
      )`,
    })
    .from(itAssetRetirements)
    .innerJoin(itAssets, eq(itAssetRetirements.assetId, itAssets.id))
    .innerJoin(users, eq(itAssetRetirements.responsibleUserId, users.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(itAssetRetirements.date))

  // `canReverse` se calcula en JS (no en SQL) para reusar `retirementTargetStatus`
  // y no duplicar la regla de negocio entre BD y aplicación.
  return rows.map((row) => {
    const blocker = retirementReverseBlocker(row)
    return { ...row, canReverse: blocker === null, reverseBlockedReason: blocker }
  })
}

export interface ReverseRetirementResult {
  assetId: string
  restoredStatus: string
}

/**
 * Revierte una baja equivocada: el activo vuelve a `previousStatus` y, si la
 * baja cerró una asignación por pérdida/robo, esa asignación se reabre.
 *
 * Es la operación más delicada del módulo — modifica un registro que ya se
 * consideraba definitivo — así que valida en este orden estricto: motivo,
 * existencia, orden de bloqueo (activo primero, igual que el resto de
 * servicios del módulo, para no abrir una ventana de deadlock con una
 * `retireAsset` concurrente), alcance de faena, y por último la regla
 * completa de `retirementReverseBlocker`.
 */
export async function reverseRetirement(
  retirementId: string,
  reason: string,
  actor: { userId: string; userEmail?: string },
  worksiteIds: TiWorksiteScope = "all",
): Promise<ReverseRetirementResult> {
  const trimmed = reason?.trim() ?? ""
  if (trimmed.length < 10) throw new Error("La reversión requiere un motivo de al menos 10 caracteres")

  return db.transaction(async (tx) => {
    const [pointer] = await tx.select({ assetId: itAssetRetirements.assetId })
      .from(itAssetRetirements).where(eq(itAssetRetirements.id, retirementId))
    if (!pointer) throw new Error("Baja no encontrada")

    // Orden de bloqueo deliberado: `retireAsset`, `createAssignment`,
    // `changeAssetStatus` y `softDeleteAsset` bloquean primero `it_assets`.
    // Bloquear antes la baja abriría una ventana de deadlock con una
    // `retireAsset` concurrente sobre el mismo activo.
    //
    // Ojo con `returnAssignment`/`transferAssignment`: esas bloquean al revés
    // (asignación y después activo). Hoy no hay deadlock alcanzable porque
    // lanzan "Esta asignación ya fue devuelta" antes de pedir el lock del
    // activo, y la asignación que se reabre acá siempre está cerrada. Si
    // alguna vez se mueve ese `throw` después del segundo lock, este orden
    // deja de ser seguro.
    const [asset] = await tx.select().from(itAssets)
      .where(and(eq(itAssets.id, pointer.assetId), isNull(itAssets.deletedAt))).for("update")
    if (!asset) throw new Error("Activo no encontrado o eliminado del inventario")
    assertTiWorksiteAccess(worksiteIds, asset.worksiteId)

    const [retirement] = await tx.select().from(itAssetRetirements)
      .where(eq(itAssetRetirements.id, retirementId)).for("update")
    if (!retirement) throw new Error("Baja no encontrada")
    if (retirement.assetId !== asset.id) throw new Error("La baja no corresponde a este activo")

    const [laterRetirement] = await tx.select({ id: itAssetRetirements.id }).from(itAssetRetirements)
      .where(sql`${itAssetRetirements.assetId} = ${asset.id}
        AND (${itAssetRetirements.createdAt}, ${itAssetRetirements.id}) > (${retirement.createdAt}, ${retirement.id})`)
      .limit(1)
    const [laterMovement] = await tx.select({ id: itAssetHistory.id }).from(itAssetHistory)
      .where(and(
        eq(itAssetHistory.assetId, asset.id),
        inArray(itAssetHistory.action, ["status_changed", "assigned", "returned"]),
        sql`${itAssetHistory.createdAt} > ${retirement.createdAt}`,
      ))
      .limit(1)
    const [openAssignmentRow] = await tx.select({ id: itAssetAssignments.id }).from(itAssetAssignments)
      .where(and(eq(itAssetAssignments.assetId, asset.id), isNull(itAssetAssignments.returnedAt)))
      .limit(1)

    const blocker = retirementReverseBlocker({
      reason: retirement.reason,
      reversedAt: retirement.reversedAt,
      previousStatus: retirement.previousStatus,
      closedAssignmentId: retirement.closedAssignmentId,
      assetStatus: asset.status,
      assetDeletedAt: asset.deletedAt,
      hasLaterRetirement: Boolean(laterRetirement),
      hasLaterMovement: Boolean(laterMovement),
      hasOpenAssignment: Boolean(openAssignmentRow),
    })
    if (blocker) throw new Error(blocker)

    const now = new Date().toISOString()
    let restoredWorkerId: string | null = retirement.previousWorkerId
    let reopenedAssignmentCode: string | null = null
    let clearedReturnObservations: string | null = null

    if (retirement.closedAssignmentId) {
      const [assignment] = await tx.select().from(itAssetAssignments)
        .where(eq(itAssetAssignments.id, retirement.closedAssignmentId)).for("update")
      if (!assignment) throw new Error("La asignación que esta baja cerró ya no existe")
      if (assignment.assetId !== asset.id) throw new Error("La asignación registrada no corresponde a este activo")
      if (!assignment.returnedAt) throw new Error(`La asignación ${assignment.code} ya está abierta`)
      // `retireAsset` nunca escribe `returnPhysicalState`: un valor no nulo
      // prueba que pasó una `returnAssignment` real encima de esta fila.
      if (assignment.returnPhysicalState) {
        throw new Error(`La asignación ${assignment.code} registra una devolución física posterior: no se puede reabrir`)
      }

      clearedReturnObservations = assignment.returnObservations
      await tx.update(itAssetAssignments).set({
        returnedAt: null,
        returnedByUserId: null,
        returnObservations: null,
        updatedAt: now,
      }).where(and(eq(itAssetAssignments.id, assignment.id), isNotNull(itAssetAssignments.returnedAt)))

      // La fila de asignación ya es NOT NULL/restrict, más confiable que
      // `previousWorkerId` (que tiene `onDelete: set null`).
      restoredWorkerId = assignment.workerId
      reopenedAssignmentCode = assignment.code
    }

    await tx.update(itAssets).set({
      status: retirement.previousStatus!,
      workerId: restoredWorkerId,
      updatedAt: now,
    }).where(eq(itAssets.id, asset.id))

    await tx.update(itAssetRetirements).set({
      reversedAt: now,
      reversedByUserId: actor.userId,
      reverseReason: trimmed,
    }).where(and(eq(itAssetRetirements.id, retirementId), isNull(itAssetRetirements.reversedAt)))

    await appendAssetHistory({
      assetId: asset.id,
      action: "retirement_reversed",
      detail: `Reversión de baja (${retirement.reason}) del ${retirement.date}. Estado restaurado: ${itStatusLabel(asset.status)} → ${itStatusLabel(retirement.previousStatus!)}.`,
      changes: {
        retirementId, reverseReason: trimmed, from: asset.status, to: retirement.previousStatus,
        restoredWorkerId, reopenedAssignmentId: retirement.closedAssignmentId, reopenedAssignmentCode,
        clearedReturnObservations,
      },
      actorUserId: actor.userId,
    }, tx)
    await recordStatusChange({
      entityType: "it_asset",
      entityId: asset.id,
      fromStatus: asset.status,
      toStatus: retirement.previousStatus!,
      changedBy: actor.userId,
      reason: trimmed,
    }, tx)
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "update",
      entityType: "it_asset_retirement",
      entityId: retirementId,
      entityCode: asset.code,
      oldState: {
        reversedAt: null, assetStatus: asset.status, assetWorkerId: asset.workerId,
        assignmentReturnObservations: clearedReturnObservations,
      },
      newState: {
        reversedAt: now, reverseReason: trimmed, assetStatus: retirement.previousStatus,
        assetWorkerId: restoredWorkerId, reopenedAssignmentId: retirement.closedAssignmentId,
      },
      reason: trimmed,
    }, tx)

    return { assetId: asset.id, restoredStatus: retirement.previousStatus! }
  })
}
