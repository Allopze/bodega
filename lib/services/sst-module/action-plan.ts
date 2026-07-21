import { z } from "zod"
import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { preventionCapaActions } from "@/db/schema"
import { sstActionPlan } from "@/db/schema/sst"
import { nanoid } from "@/lib/id"
import { sstActionPlanItemSchema } from "@/lib/validation/sst"
import { getEvaluation } from "./evaluations"
import {
  createCapaActionWithClient,
  transitionCapaActionWithClient,
  updateCapaActionWithClient,
} from "@/lib/services/prevention-capa"

function capaAccess(userId: string, worksiteIds: string[] | "all") {
  return {
    ctx: { userId },
    scope: worksiteIds === "all" ? { mode: "all" as const, ids: [] as [] } : worksiteIds.length > 0
      ? { mode: "some" as const, ids: worksiteIds }
      : { mode: "none" as const, ids: [] as [] },
    permissions: ["prevention:capa:manage", "prevention:capa:complete"],
  }
}

export async function saveActionPlanItem(input: z.infer<typeof sstActionPlanItemSchema>, worksiteIds: string[] | "all", userId: string) {
  const data = sstActionPlanItemSchema.parse(input)
  const evaluation = await getEvaluation(data.evaluationId, worksiteIds)
  if (!evaluation) throw new Error("Evaluación no encontrada o sin acceso.")
  const [existing] = await db.select().from(sstActionPlan)
    .where(and(eq(sstActionPlan.evaluationId, data.evaluationId), eq(sstActionPlan.n, data.n)))
    .limit(1)
  const expectedLegacyStatus = existing?.estado ?? "pendiente"
  if (data.estado !== expectedLegacyStatus) {
    throw new Error("El estado CAPA se cambia mediante su flujo de implementación y verificación, no desde la edición del ítem.")
  }
  const legacyId = existing?.id ?? nanoid()

  return db.transaction(async (tx) => {
    let capaActionId = existing?.capaActionId ?? null
    if (capaActionId) {
      const [capa] = await tx.select().from(preventionCapaActions)
        .where(eq(preventionCapaActions.id, capaActionId)).limit(1)
      if (!capa) throw new Error("La acción CAPA vinculada no existe.")
      await updateCapaActionWithClient(tx, {
        actionId: capa.id,
        expectedVersion: capa.version,
        finding: data.hallazgo,
        actionDescription: data.accion,
        responsibleSnapshot: data.responsable,
        targetDate: data.plazo,
      }, capaAccess(userId, worksiteIds))
    } else {
      const capa = await createCapaActionWithClient(tx, {
        sourceType: "sst_evaluation",
        sourceId: data.evaluationId,
        sourceLegacyActionId: legacyId,
        worksiteId: evaluation.worksiteId,
        finding: data.hallazgo,
        actionDescription: data.accion,
        responsibleSnapshot: data.responsable,
        priority: "medium",
        targetDate: data.plazo,
        evidenceRequired: true,
        reconciliationStatus: "needs_assignment",
      }, userId)
      capaActionId = capa.id
    }

    const [upserted] = await tx.insert(sstActionPlan).values({
      id: legacyId,
      evaluationId: data.evaluationId,
      capaActionId,
      n: data.n,
      hallazgo: data.hallazgo,
      accion: data.accion,
      responsable: data.responsable,
      plazo: data.plazo,
      estado: expectedLegacyStatus,
    }).onConflictDoUpdate({
      target: [sstActionPlan.evaluationId, sstActionPlan.n],
      set: {
        capaActionId,
        hallazgo: data.hallazgo,
        accion: data.accion,
        responsable: data.responsable,
        plazo: data.plazo,
      },
    }).returning()
    if (!upserted) throw new Error("No se pudo guardar el plan de acción.")
    return upserted
  })
}

export async function deleteActionPlanItem(id: string, worksiteIds: string[] | "all", userId: string): Promise<void> {
  const [item] = await db.select({ evaluationId: sstActionPlan.evaluationId, capaActionId: sstActionPlan.capaActionId }).from(sstActionPlan).where(eq(sstActionPlan.id, id)).limit(1)
  if (!item) throw new Error("Ítem del plan de acción no encontrado.")
  const evaluation = await getEvaluation(item.evaluationId, worksiteIds)
  if (!evaluation) throw new Error("Evaluación no encontrada o sin acceso.")
  if (!item.capaActionId) throw new Error("El ítem no tiene una acción CAPA vinculada.")
  await db.transaction(async (tx) => {
    const [capa] = await tx.select().from(preventionCapaActions)
      .where(eq(preventionCapaActions.id, item.capaActionId!)).limit(1)
    if (!capa) throw new Error("La acción CAPA vinculada no existe.")
    if (capa.status !== "cancelled") {
      await transitionCapaActionWithClient(tx, {
        actionId: capa.id,
        expectedVersion: capa.version,
        toStatus: "cancelled",
        reason: "Ítem cancelado formalmente desde la evaluación SST.",
      }, capaAccess(userId, worksiteIds))
    }
    await tx.update(sstActionPlan).set({ estado: "cancelado" }).where(eq(sstActionPlan.id, id))
  })
}
