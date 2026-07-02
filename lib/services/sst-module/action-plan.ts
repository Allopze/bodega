import { z } from "zod"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { sstActionPlan } from "@/db/schema/sst"
import { nanoid } from "@/lib/id"
import { sstActionPlanItemSchema } from "@/lib/validation/sst"
import { getEvaluation } from "./evaluations"

export async function saveActionPlanItem(input: z.infer<typeof sstActionPlanItemSchema>, worksiteIds: string[] | "all") {
  const data = sstActionPlanItemSchema.parse(input)
  const evaluation = await getEvaluation(data.evaluationId, worksiteIds)
  if (!evaluation) throw new Error("Evaluación no encontrada o sin acceso.")
  const [upserted] = await db.insert(sstActionPlan).values({ id: nanoid(), evaluationId: data.evaluationId, n: data.n, hallazgo: data.hallazgo, accion: data.accion, responsable: data.responsable, plazo: data.plazo, estado: data.estado })
    .onConflictDoUpdate({ target: [sstActionPlan.evaluationId, sstActionPlan.n], set: { hallazgo: data.hallazgo, accion: data.accion, responsable: data.responsable, plazo: data.plazo, estado: data.estado } }).returning()
  if (!upserted) throw new Error("No se pudo guardar el plan de acción.")
  return upserted
}

export async function deleteActionPlanItem(id: string, worksiteIds: string[] | "all"): Promise<void> {
  const [item] = await db.select({ evaluationId: sstActionPlan.evaluationId }).from(sstActionPlan).where(eq(sstActionPlan.id, id)).limit(1)
  if (!item) throw new Error("Ítem del plan de acción no encontrado.")
  const evaluation = await getEvaluation(item.evaluationId, worksiteIds)
  if (!evaluation) throw new Error("Evaluación no encontrada o sin acceso.")
  await db.delete(sstActionPlan).where(eq(sstActionPlan.id, id))
}
