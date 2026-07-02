import { eq } from "drizzle-orm"
import { db } from "@/db"
import { sstWeeklyEvaluations } from "@/db/schema/sst"
import { getEvaluation } from "./evaluations"

export async function getWeeklyEvaluations(evaluationId: string, worksiteIds: string[] | "all") {
  const evaluation = await getEvaluation(evaluationId, worksiteIds)
  if (!evaluation) throw new Error("Evaluación no encontrada o sin acceso.")
  return db.select().from(sstWeeklyEvaluations).where(eq(sstWeeklyEvaluations.evaluationId, evaluationId)).orderBy(sstWeeklyEvaluations.semana)
}

export async function markWeekCompleted(weeklyEvalId: string, worksiteIds: string[] | "all"): Promise<void> {
  const [weekly] = await db.select().from(sstWeeklyEvaluations).where(eq(sstWeeklyEvaluations.id, weeklyEvalId)).limit(1)
  if (!weekly) throw new Error("Semana de evaluación no encontrada.")
  const evaluation = await getEvaluation(weekly.evaluationId, worksiteIds)
  if (!evaluation) throw new Error("Evaluación no encontrada o sin acceso.")
  if (evaluation.estado === "cerrado") throw new Error("Esta evaluación está cerrada y sus semanas no pueden modificarse.")

  const today = new Date().toISOString().slice(0, 10)
  if (today < weekly.fechaDesbloqueo) throw new Error(`La semana ${weekly.semana} está bloqueada hasta ${weekly.fechaDesbloqueo}.`)
  if (weekly.estado === "completada") throw new Error(`La semana ${weekly.semana} ya está completada.`)
  await db.update(sstWeeklyEvaluations).set({ estado: "completada", fechaCompletada: today }).where(eq(sstWeeklyEvaluations.id, weeklyEvalId))
}
