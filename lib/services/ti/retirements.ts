import { eq, and, isNull, desc, sql, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { itAssetRetirements, itAssets, itAssetAssignments, users } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { appendAssetHistory } from "./history"
import { assertTiWorksiteAccess, type TiWorksiteScope } from "./scope"


export interface RetireAssetInput {
  assetId: string
  date: string
  reason: string
  responsibleUserId: string
  authorizedByUserId: string
  destination?: string | null
  observations?: string | null
}

export function retirementTargetStatus(reason: string): string {
  return reason === "perdida" ? "perdido" : reason === "robo" ? "robado" : "dado_de_baja"
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
    if (["dado_de_baja", "perdido", "robado"].includes(asset.status)) {
      throw new Error(`El activo ya está en estado '${asset.status}'`)
    }

    // Una asignación abierta debe cerrarse antes de dar de baja (custodia clara).
    const openAssignments = await tx.select({ id: itAssetAssignments.id, code: itAssetAssignments.code })
      .from(itAssetAssignments)
      .where(and(eq(itAssetAssignments.assetId, input.assetId), sql`${itAssetAssignments.returnedAt} IS NULL`))
    const openAssignment = openAssignments[0]
    if (openAssignment && !["perdida", "robo"].includes(input.reason)) {
      throw new Error(`El activo tiene la asignación ${openAssignment.code} abierta: devuélvelo antes de dar de baja`)
    }

    const targetStatus = retirementTargetStatus(input.reason)
    const now = new Date().toISOString()
    const reasonLabel = input.reason === "perdida" ? "pérdida" : input.reason

    // Pérdida y robo son excepciones a la devolución física, no una segunda
    // forma de mantener una custodia abierta. Se cierra el tramo histórico
    // dejando el motivo en las observaciones para que los indicadores de
    // custodia y las consultas de asignaciones no sigan contando el activo.
    if (openAssignments.length > 0 && ["perdida", "robo"].includes(input.reason)) {
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
  return db
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
    })
    .from(itAssetRetirements)
    .innerJoin(itAssets, eq(itAssetRetirements.assetId, itAssets.id))
    .innerJoin(users, eq(itAssetRetirements.responsibleUserId, users.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(itAssetRetirements.date))
}
