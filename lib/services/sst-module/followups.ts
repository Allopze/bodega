import { z } from "zod"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { sstScheduledFollowups } from "@/db/schema/sst"
import { sstFollowupMarkSchema } from "@/lib/validation/sst"
import { getEvaluation } from "./evaluations"

export async function markFollowup(followupId: string, input: z.infer<typeof sstFollowupMarkSchema>, worksiteIds: string[] | "all"): Promise<void> {
  const [followup] = await db.select().from(sstScheduledFollowups).where(eq(sstScheduledFollowups.id, followupId)).limit(1)
  if (!followup) throw new Error("Seguimiento no encontrado.")
  const evaluation = await getEvaluation(followup.evaluationId, worksiteIds)
  if (!evaluation) throw new Error("Evaluación no encontrada o sin acceso.")
  const data = sstFollowupMarkSchema.parse(input)
  await db.update(sstScheduledFollowups).set({ realizado: data.realizado, cumple: data.cumple, observaciones: data.observaciones ?? null }).where(eq(sstScheduledFollowups.id, followupId))
}

export async function getFollowups(evaluationId: string, worksiteIds: string[] | "all") {
  const evaluation = await getEvaluation(evaluationId, worksiteIds)
  if (!evaluation) throw new Error("Evaluación no encontrada o sin acceso.")
  return db.select().from(sstScheduledFollowups).where(eq(sstScheduledFollowups.evaluationId, evaluationId))
}
