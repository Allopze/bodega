import { z } from "zod"
import { db } from "@/db"
import { sstActionPlanItemSchema } from "@/lib/validation/sst"
import { getEvaluation } from "./evaluations"
import {
  capaToSstActionPlanItem,
  findSstActionPlanItem,
  loadSstCapa,
  sstEstado,
} from "./capa-view"
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

/**
 * Alta o edición del ítem `n` del plan de acción de una evaluación.
 *
 * D11: la acción vive en `prevention_capa_actions`. `n` viaja en su
 * `source_ref` porque es la fila del acta que el evaluador edita, no una
 * numeración derivable — ver `sst-module/capa-view.ts`.
 */
export async function saveActionPlanItem(input: z.infer<typeof sstActionPlanItemSchema>, worksiteIds: string[] | "all", userId: string) {
  const data = sstActionPlanItemSchema.parse(input)

  return db.transaction(async (tx) => {
    const evaluation = await getEvaluation(data.evaluationId, worksiteIds, tx)
    if (!evaluation) throw new Error("Evaluación no encontrada o sin acceso.")
    // NO lleva `assertEditable`, a diferencia de `saveResponses`: lo inmutable
    // al cerrar es el acta (respuestas y hallazgos), no el plan de acción, que
    // se sigue trabajando después del cierre. Cubierto por el test
    // "allows continuing the corrective action plan after the evaluation is
    // closed" en `sst-delete-evaluation.test.ts`.
    const existing = await findSstActionPlanItem(tx, data.evaluationId, data.n)
    const estadoActual = existing ? sstEstado(existing.status) : "pendiente"
    if (data.estado !== estadoActual) {
      throw new Error("El estado CAPA se cambia mediante su flujo de implementación y verificación, no desde la edición del ítem.")
    }

    if (existing) {
      const updated = await updateCapaActionWithClient(tx, {
        actionId: existing.id,
        expectedVersion: existing.version,
        finding: data.hallazgo,
        actionDescription: data.accion,
        responsibleSnapshot: data.responsable,
        targetDate: data.plazo,
      }, capaAccess(userId, worksiteIds))
      return capaToSstActionPlanItem(updated)
    }

    const capa = await createCapaActionWithClient(tx, {
      sourceType: "sst_evaluation",
      sourceId: data.evaluationId,
      worksiteId: evaluation.worksiteId,
      finding: data.hallazgo,
      actionDescription: data.accion,
      responsibleSnapshot: data.responsable,
      priority: "medium",
      targetDate: data.plazo,
      evidenceRequired: true,
      sourceRef: { n: data.n },
      reconciliationStatus: "needs_assignment",
    }, userId)
    return capaToSstActionPlanItem(capa)
  })
}

/** Conserva el ítem y lo cancela con historial en vez de borrarlo. */
export async function deleteActionPlanItem(id: string, worksiteIds: string[] | "all", userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const capa = await loadSstCapa(tx, id)
    if (!capa) throw new Error("Ítem del plan de acción no encontrado.")
    const evaluation = await getEvaluation(capa.sourceId, worksiteIds, tx)
    if (!evaluation) throw new Error("Evaluación no encontrada o sin acceso.")
    if (capa.status === "cancelled") return
    await transitionCapaActionWithClient(tx, {
      actionId: capa.id,
      expectedVersion: capa.version,
      toStatus: "cancelled",
      reason: "Ítem cancelado formalmente desde la evaluación SST.",
    }, capaAccess(userId, worksiteIds))
  })
}
