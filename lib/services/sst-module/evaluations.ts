import { z } from "zod"
import { eq, and, inArray, desc, sql } from "drizzle-orm"
import { db } from "@/db"
import { sstEvaluations, sstResponses, sstScheduledFollowups, sstWeeklyEvaluations, sstActionPlan, type SstEvaluation } from "@/db/schema/sst"
import { workers, worksites } from "@/db/schema/worksites"
import { nanoid } from "@/lib/id"
import { addDays } from "@/lib/sst/date"
import { getDefinition } from "@/lib/sst/definitions/index"
import { calculateCompliance, getAutomaticResultadoFinal, classifyEfficacy } from "@/lib/sst/compliance"
import { sstEvaluationCreateSchema, sstCloseEvaluationSchema } from "@/lib/validation/sst"
import type { StatusValue, EvaluatorRole } from "@/lib/sst/types"
import { assertEditable, getEvaluationApplicableItems, SECTIONS_EXCLUDED_FROM_PERCENTAGE } from "./helpers"

export async function createEvaluation(input: z.infer<typeof sstEvaluationCreateSchema>, userId: string, evaluatorRole?: EvaluatorRole): Promise<SstEvaluation> {
  const data = sstEvaluationCreateSchema.parse(input)
  const id = nanoid()
  const now = new Date().toISOString()
  const definition = getDefinition(data.definicionCode)
  const resolvedRole: EvaluatorRole | null = evaluatorRole ?? data.evaluatorRole ?? null

  await db.transaction(async (tx) => {
    await tx.insert(sstEvaluations).values({
      id, worksiteId: data.worksiteId, workerId: data.workerId, createdBy: userId,
      definicionCode: data.definicionCode, definicionVersion: definition.version,
      tipo: data.tipo, evaluatorRole: resolvedRole, motivo: data.motivo ?? null,
      motivoOtro: data.motivoOtro ?? null, descripcionEvento: data.descripcionEvento ?? null,
      equipoPatente: data.equipoPatente ?? null, fechaEvaluacion: data.fechaEvaluacion,
      estado: "borrador", cargosJson: data.cargos, resultadoFinal: null,
      porcentajeCumplimiento: null, resultadoEficacia: null, restricciones: null,
      observacionesGenerales: null, schemaJson: null, createdAt: now, updatedAt: now,
    })

    if (data.tipo === "seguimiento") {
      for (const { instancia, days } of [{ instancia: "dia_0", days: 0 }, { instancia: "dia_7", days: 7 }, { instancia: "dia_15", days: 15 }, { instancia: "dia_30", days: 30 }]) {
        await tx.insert(sstScheduledFollowups).values({ id: nanoid(), evaluationId: id, instancia, fechaProgramada: addDays(data.fechaEvaluacion, days), cumple: null, observaciones: null, realizado: false })
      }
    }

    if (resolvedRole === "conductor_lider" && data.definicionCode === "trabajador_nuevo") {
      for (const { semana, days } of [{ semana: 1, days: 0 }, { semana: 2, days: 7 }, { semana: 3, days: 14 }, { semana: 4, days: 21 }]) {
        await tx.insert(sstWeeklyEvaluations).values({ id: nanoid(), evaluationId: id, semana, fechaDesbloqueo: addDays(data.fechaEvaluacion, days), estado: "pendiente", fechaCompletada: null, alertSentAt: null })
      }
    }
  })

  const [evaluation] = await db.select().from(sstEvaluations).where(eq(sstEvaluations.id, id)).limit(1)
  if (!evaluation) throw new Error("No se pudo crear la evaluación.")
  return evaluation
}

export async function getEvaluation(id: string, worksiteIds: string[] | "all"): Promise<SstEvaluation | null> {
  if (worksiteIds !== "all" && worksiteIds.length === 0) return null
  const [evaluation] = await db.select().from(sstEvaluations).where(eq(sstEvaluations.id, id)).limit(1)
  if (!evaluation) return null
  if (worksiteIds !== "all" && !worksiteIds.includes(evaluation.worksiteId)) return null
  return evaluation
}

export async function listEvaluations(filters: { worksiteIds: string[] | "all"; tipo?: string; estado?: string; workerId?: string }, limit = 50, offset = 0) {
  if (filters.worksiteIds !== "all" && filters.worksiteIds.length === 0) return []
  const conditions = []
  if (filters.worksiteIds !== "all") conditions.push(inArray(sstEvaluations.worksiteId, filters.worksiteIds))
  if (filters.tipo) conditions.push(eq(sstEvaluations.tipo, filters.tipo))
  if (filters.estado) conditions.push(eq(sstEvaluations.estado, filters.estado))
  if (filters.workerId) conditions.push(eq(sstEvaluations.workerId, filters.workerId))

  const rows = await db.select({
    id: sstEvaluations.id, worksiteId: sstEvaluations.worksiteId, workerId: sstEvaluations.workerId,
    createdBy: sstEvaluations.createdBy, definicionCode: sstEvaluations.definicionCode,
    definicionVersion: sstEvaluations.definicionVersion, tipo: sstEvaluations.tipo,
    evaluatorRole: sstEvaluations.evaluatorRole, motivo: sstEvaluations.motivo,
    motivoOtro: sstEvaluations.motivoOtro, descripcionEvento: sstEvaluations.descripcionEvento,
    equipoPatente: sstEvaluations.equipoPatente, fechaEvaluacion: sstEvaluations.fechaEvaluacion,
    estado: sstEvaluations.estado, cargosJson: sstEvaluations.cargosJson,
    resultadoFinal: sstEvaluations.resultadoFinal, porcentajeCumplimiento: sstEvaluations.porcentajeCumplimiento,
    resultadoEficacia: sstEvaluations.resultadoEficacia, restricciones: sstEvaluations.restricciones,
    observacionesGenerales: sstEvaluations.observacionesGenerales, schemaJson: sstEvaluations.schemaJson,
    createdAt: sstEvaluations.createdAt, updatedAt: sstEvaluations.updatedAt,
    workerFirstName: workers.firstName, workerLastName: workers.lastName, worksiteName: worksites.name,
  }).from(sstEvaluations).leftJoin(workers, eq(sstEvaluations.workerId, workers.id)).leftJoin(worksites, eq(sstEvaluations.worksiteId, worksites.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined).orderBy(desc(sstEvaluations.createdAt)).limit(limit).offset(offset)

  return rows.map((r) => ({ ...r, workerName: `${r.workerFirstName ?? ""} ${r.workerLastName ?? ""}`.trim(), worksiteName: r.worksiteName ?? "" }))
}

export interface WorkerEvaluationGroup {
  workerId: string; workerName: string; workerRut: string; worksiteId: string
  worksiteName: string; evaluations: (SstEvaluation & { workerName: string; worksiteName: string; workerRut: string })[]
}

export async function listEvaluationsGroupedByWorker(worksiteIds: string[] | "all", limit = 50, offset = 0): Promise<WorkerEvaluationGroup[]> {
  if (worksiteIds !== "all" && worksiteIds.length === 0) return []
  const scopeCond = worksiteIds !== "all" ? inArray(sstEvaluations.worksiteId, worksiteIds) : undefined
  const rows = await db.select({
    id: sstEvaluations.id, worksiteId: sstEvaluations.worksiteId, workerId: sstEvaluations.workerId,
    createdBy: sstEvaluations.createdBy, definicionCode: sstEvaluations.definicionCode,
    definicionVersion: sstEvaluations.definicionVersion, tipo: sstEvaluations.tipo,
    evaluatorRole: sstEvaluations.evaluatorRole, motivo: sstEvaluations.motivo,
    motivoOtro: sstEvaluations.motivoOtro, descripcionEvento: sstEvaluations.descripcionEvento,
    equipoPatente: sstEvaluations.equipoPatente, fechaEvaluacion: sstEvaluations.fechaEvaluacion,
    estado: sstEvaluations.estado, cargosJson: sstEvaluations.cargosJson,
    resultadoFinal: sstEvaluations.resultadoFinal, porcentajeCumplimiento: sstEvaluations.porcentajeCumplimiento,
    resultadoEficacia: sstEvaluations.resultadoEficacia, restricciones: sstEvaluations.restricciones,
    observacionesGenerales: sstEvaluations.observacionesGenerales, schemaJson: sstEvaluations.schemaJson,
    createdAt: sstEvaluations.createdAt, updatedAt: sstEvaluations.updatedAt,
    workerFirstName: workers.firstName, workerLastName: workers.lastName, workerRut: workers.rut, worksiteName: worksites.name,
  }).from(sstEvaluations).leftJoin(workers, eq(sstEvaluations.workerId, workers.id)).leftJoin(worksites, eq(sstEvaluations.worksiteId, worksites.id)).where(scopeCond).orderBy(desc(sstEvaluations.createdAt))

  const groupMap = new Map<string, WorkerEvaluationGroup>()
  for (const r of rows) {
    const ev = { id: r.id, worksiteId: r.worksiteId, workerId: r.workerId, createdBy: r.createdBy, definicionCode: r.definicionCode, definicionVersion: r.definicionVersion, tipo: r.tipo, evaluatorRole: r.evaluatorRole, motivo: r.motivo, motivoOtro: r.motivoOtro, descripcionEvento: r.descripcionEvento, equipoPatente: r.equipoPatente, fechaEvaluacion: r.fechaEvaluacion, estado: r.estado, cargosJson: r.cargosJson, resultadoFinal: r.resultadoFinal, porcentajeCumplimiento: r.porcentajeCumplimiento, resultadoEficacia: r.resultadoEficacia, restricciones: r.restricciones, observacionesGenerales: r.observacionesGenerales, schemaJson: r.schemaJson, createdAt: r.createdAt, updatedAt: r.updatedAt, workerName: `${r.workerFirstName ?? ""} ${r.workerLastName ?? ""}`.trim(), worksiteName: r.worksiteName ?? "", workerRut: r.workerRut ?? "" } as any
    const existing = groupMap.get(r.workerId)
    if (existing) existing.evaluations.push(ev)
    else groupMap.set(r.workerId, { workerId: r.workerId, workerName: `${r.workerFirstName ?? ""} ${r.workerLastName ?? ""}`.trim(), workerRut: r.workerRut ?? "", worksiteId: r.worksiteId, worksiteName: r.worksiteName ?? "", evaluations: [ev] })
  }
  return [...groupMap.values()].slice(offset, offset + limit)
}

export async function closeEvaluation(id: string, input: z.infer<typeof sstCloseEvaluationSchema>, worksiteIds: string[] | "all"): Promise<SstEvaluation> {
  const evaluation = await getEvaluation(id, worksiteIds)
  if (!evaluation) throw new Error("Evaluación no encontrada o sin acceso.")
  if (evaluation.estado === "cerrado") return evaluation

  const data = sstCloseEvaluationSchema.parse(input)
  const definition = getDefinition(evaluation.definicionCode, evaluation.definicionVersion)
  const cargos = (evaluation.cargosJson as string[]) ?? []
  const applicableItems = getEvaluationApplicableItems(definition, cargos, evaluation.evaluatorRole)
  const applicableSet = new Set(applicableItems.map((ai) => `${ai.seccionId}::${ai.item.id}`))

  let updated: SstEvaluation | undefined
  await db.transaction(async (tx) => {
    await assertEditable(id, tx)
    const allResponses = await tx.select().from(sstResponses).where(eq(sstResponses.evaluationId, id))
    const applicableResponses = allResponses.filter((r) => applicableSet.has(`${r.seccionId}::${r.itemId}`))
    const responseByItem = new Map(applicableResponses.map((r) => [`${r.seccionId}::${r.itemId}`, r]))
    const unanswered = applicableItems.filter(({ seccionId, item }) => { const resp = responseByItem.get(`${seccionId}::${item.id}`); return !resp || resp.estado === null })
    if (unanswered.length > 0) throw new Error(`No se puede cerrar la evaluación: hay ${unanswered.length} ítem(s) aplicable(s) sin responder. Primer pendiente: ${unanswered[0]!.seccionId} / ${unanswered[0]!.item.label}.`)

    const excludedSections = SECTIONS_EXCLUDED_FROM_PERCENTAGE[evaluation.definicionCode] ?? []
    const complianceInput = applicableResponses.filter((r) => !excludedSections.includes(r.seccionId)).map((r) => ({ estado: r.estado as StatusValue }))
    const { percentage } = calculateCompliance(complianceInput)
    const responsesForResultado = applicableResponses.map((r) => ({ seccionId: r.seccionId, itemId: r.itemId, estado: r.estado as StatusValue }))
    const resultadoFinal = getAutomaticResultadoFinal(evaluation.definicionCode, percentage, responsesForResultado, data.hasCriticalDeviation ?? false, data.hasReincidence ?? false)

    let resultadoEficacia: string | null = null
    if (evaluation.definicionCode === "trabajador_antiguo") {
      const BLOCKER_SECTIONS = ["procedimientos_criticos", "control_ampliroll", "control_batea", "control_maquinaria"]
      const NEGATIVE_STATUSES = ["no_cumple", "no_entregado", "no_apto", "no"]
      const hasBlocker = applicableResponses.some((r) => r.itemId === "protocolos_minsal" ? false : BLOCKER_SECTIONS.includes(r.seccionId) && NEGATIVE_STATUSES.includes(r.estado ?? ""))
      resultadoEficacia = classifyEfficacy(percentage, data.hasCriticalDeviation ?? false, data.hasReincidence ?? false, hasBlocker).classification
    }

    const now = new Date().toISOString()
    await tx.update(sstEvaluations).set({ estado: "cerrado", porcentajeCumplimiento: percentage, resultadoFinal, resultadoEficacia, restricciones: data.restricciones ?? null, observacionesGenerales: data.observacionesGenerales ?? null, schemaJson: JSON.stringify(definition), updatedAt: now }).where(eq(sstEvaluations.id, id))
    const [row] = await tx.select().from(sstEvaluations).where(eq(sstEvaluations.id, id)).limit(1)
    updated = row
  })
  if (!updated) throw new Error("Evaluation not found after update")
  return updated
}

export async function deleteEvaluation(id: string, worksiteIds: string[] | "all"): Promise<void> {
  const evaluation = await getEvaluation(id, worksiteIds)
  if (!evaluation) throw new Error("Evaluación no encontrada o sin acceso.")
  if (evaluation.estado === "cerrado") throw new Error("Esta evaluación está cerrada y no puede eliminarse. Usa un flujo de anulación auditada si necesitas invalidarla.")
  await db.transaction(async (tx) => {
    await tx.delete(sstActionPlan).where(eq(sstActionPlan.evaluationId, id))
    await tx.delete(sstScheduledFollowups).where(eq(sstScheduledFollowups.evaluationId, id))
    await tx.delete(sstResponses).where(eq(sstResponses.evaluationId, id))
    await tx.delete(sstEvaluations).where(eq(sstEvaluations.id, id))
  })
}
