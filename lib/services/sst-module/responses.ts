import { z } from "zod"
import { db } from "@/db"
import { sstResponses } from "@/db/schema/sst"
import { nanoid } from "@/lib/id"
import { sstResponsesBatchSchema } from "@/lib/validation/sst"
import { getEvaluation, deleteEvaluation } from "./evaluations"
import { assertEditable } from "./helpers"

export async function saveResponses(evaluationId: string, responses: z.infer<typeof sstResponsesBatchSchema>, worksiteIds: string[] | "all"): Promise<void> {
  if (worksiteIds !== "all" && worksiteIds.length === 0) throw new Error("Evaluación no encontrada o sin acceso.")
  const evaluation = await getEvaluation(evaluationId, worksiteIds)
  if (!evaluation) throw new Error("Evaluación no encontrada o sin acceso.")
  const data = sstResponsesBatchSchema.parse(responses)
  if (data.some((resp) => resp.evaluationId !== evaluationId)) throw new Error("La respuesta no corresponde a la evaluación indicada.")
  await db.transaction(async (tx) => {
    await assertEditable(evaluationId, tx)
    for (const resp of data) {
      await tx.insert(sstResponses).values({ id: nanoid(), evaluationId: resp.evaluationId, seccionId: resp.seccionId, itemId: resp.itemId, estado: resp.estado ?? null, observacion: resp.observacion ?? null, accionCorrectiva: resp.accionCorrectiva ?? null })
        .onConflictDoUpdate({ target: [sstResponses.evaluationId, sstResponses.seccionId, sstResponses.itemId], set: { estado: resp.estado ?? null, observacion: resp.observacion ?? null, accionCorrectiva: resp.accionCorrectiva ?? null } })
    }
  })
}
