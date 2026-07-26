import { z } from "zod"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { sstScheduledFollowups } from "@/db/schema/sst"
import { sstFollowupMarkSchema } from "@/lib/validation/sst"
import { getEvaluation } from "./evaluations"
import { recordOperationalActivity } from "@/lib/services/operational-activity"

export async function markFollowup(
  followupId: string,
  input: z.infer<typeof sstFollowupMarkSchema>,
  worksiteIds: string[] | "all",
  actorUserId?: string,
): Promise<void> {
  const [followup] = await db.select().from(sstScheduledFollowups).where(eq(sstScheduledFollowups.id, followupId)).limit(1)
  if (!followup) throw new Error("Seguimiento no encontrado.")
  const evaluation = await getEvaluation(followup.evaluationId, worksiteIds)
  if (!evaluation) throw new Error("Evaluación no encontrada o sin acceso.")
  const data = sstFollowupMarkSchema.parse(input)
  await db.transaction(async (tx) => {
    const [updated] = await tx.update(sstScheduledFollowups)
      .set({ realizado: data.realizado, cumple: data.cumple, observaciones: data.observaciones ?? null })
      .where(eq(sstScheduledFollowups.id, followupId))
      .returning()
    if (!updated) throw new Error("No se pudo actualizar el seguimiento.")
    if (!followup.realizado && updated.realizado) {
      await recordOperationalActivity({
        eventType: "sst.followup_completed",
        module: "sst",
        entityType: "sst_followup",
        entityId: updated.id,
        worksiteId: evaluation.worksiteId,
        actorUserId: actorUserId ?? null,
        payload: { instance: updated.instancia, completed: true },
      }, tx)
    }
  })
}

export async function getFollowups(evaluationId: string, worksiteIds: string[] | "all") {
  const evaluation = await getEvaluation(evaluationId, worksiteIds)
  if (!evaluation) throw new Error("Evaluación no encontrada o sin acceso.")
  return db.select().from(sstScheduledFollowups).where(eq(sstScheduledFollowups.evaluationId, evaluationId))
}
