import type { Session } from "next-auth"
import { db } from "@/db"
import { sstEvaluations, sstResponses, sstScheduledFollowups, sstActionPlan } from "@/db/schema/sst"
import { users, userRoles, roles } from "@/db/schema/users"
import { workers, worksites } from "@/db/schema/worksites"
import { eq } from "drizzle-orm"
import { canAccessWorksite } from "@/lib/auth/can"
import { getDefinition } from "@/lib/sst/definitions"
import { CARGO_KEYS } from "@/lib/sst/cargos"
import { buildActaFilename } from "@/lib/sst/acta-filename"
import type { ChecklistDefinition } from "@/lib/sst/types"

export type ActaData = {
  evaluation: typeof sstEvaluations.$inferSelect
  worker: typeof workers.$inferSelect
  worksite: typeof worksites.$inferSelect
  createdByUser: typeof users.$inferSelect | null
  evaluatorRoleLabel: string
  definition: ChecklistDefinition
  responses: (typeof sstResponses.$inferSelect)[]
  followups: (typeof sstScheduledFollowups.$inferSelect)[]
  actionPlan: (typeof sstActionPlan.$inferSelect)[]
  isNuevo: boolean
  isCerrado: boolean
  cargos: string[]
  cargoLabels: string
  bySection: Record<string, (typeof sstResponses.$inferSelect)[]>
  applicableSections: ChecklistDefinition["sections"]
  suggestedFilename: string
  resultColor: string
  resultBorder: string
}

/**
 * Loads and assembles the acta view model. Returns null when the evaluation
 * doesn't exist or the session can't access its worksite (callers map to 404).
 * Assumes the caller already enforced the `sst:view` permission.
 */
export async function loadActaData(id: string, session: Session): Promise<ActaData | null> {
  const evaluation = await db.query.sstEvaluations.findFirst({
    where: eq(sstEvaluations.id, id),
  })
  if (!evaluation) return null
  if (!canAccessWorksite(session, evaluation.worksiteId)) return null

  const [worker, worksite, createdByUser, evaluatorRoleRows, responses, followups, actionPlan] = await Promise.all([
    db.query.workers.findFirst({ where: eq(workers.id, evaluation.workerId) }),
    db.query.worksites.findFirst({ where: eq(worksites.id, evaluation.worksiteId) }),
    db.query.users.findFirst({ where: eq(users.id, evaluation.createdBy) }),
    db.select({ label: roles.label })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, evaluation.createdBy)),
    db.select().from(sstResponses).where(eq(sstResponses.evaluationId, id)),
    db.select().from(sstScheduledFollowups).where(eq(sstScheduledFollowups.evaluationId, id)),
    db.select().from(sstActionPlan).where(eq(sstActionPlan.evaluationId, id)),
  ])

  if (!worker || !worksite) return null

  const evaluatorRoleLabels = evaluatorRoleRows.map((r) => r.label)
  const evaluatorRoleLabel: string = evaluatorRoleLabels[0] ?? 'Evaluador'

  // Resolve definition — use snapshot when cerrado for legal traceability
  let definition: ChecklistDefinition
  if (evaluation.estado === "cerrado" && evaluation.schemaJson) {
    try {
      definition = JSON.parse(evaluation.schemaJson) as ChecklistDefinition
    } catch {
      definition = getDefinition(evaluation.definicionCode, evaluation.definicionVersion)
    }
  } else {
    definition = getDefinition(evaluation.definicionCode, evaluation.definicionVersion)
  }

  const isNuevo = evaluation.tipo === "nuevo"
  const isCerrado = evaluation.estado === "cerrado"

  const cargos: string[] = Array.isArray(evaluation.cargosJson)
    ? (evaluation.cargosJson as string[])
    : []
  const cargoLabels = cargos
    .map((k) => (CARGO_KEYS as Record<string, string>)[k] ?? k)
    .join(", ")

  const bySection: Record<string, typeof responses> = {}
  for (const r of responses) {
    ;(bySection[r.seccionId] ??= []).push(r)
  }

  const applicableSections = definition.sections.filter((sec) => {
    if (!sec.appliesWhen || sec.appliesWhen.length === 0) return true
    return cargos.some((c) => sec.appliesWhen!.includes(c))
  })

  const suggestedFilename = buildActaFilename({
    tipo: evaluation.tipo,
    workerName: `${worker.firstName} ${worker.lastName}`,
  })

  const resultColor =
    evaluation.resultadoFinal === "no_habilitado" ||
    evaluation.resultadoFinal === "requiere_reforzamiento"
      ? "#fef2f2"
      : evaluation.resultadoFinal === "habilitado_restricciones"
        ? "#fffbeb"
        : "#f0fdf4"

  const resultBorder =
    evaluation.resultadoFinal === "no_habilitado" ||
    evaluation.resultadoFinal === "requiere_reforzamiento"
      ? "#fca5a5"
      : evaluation.resultadoFinal === "habilitado_restricciones"
        ? "#fcd34d"
        : "#86efac"

  return {
    evaluation,
    worker,
    worksite,
    createdByUser: createdByUser ?? null,
    evaluatorRoleLabel,
    definition,
    responses,
    followups,
    actionPlan,
    isNuevo,
    isCerrado,
    cargos,
    cargoLabels,
    bySection,
    applicableSections,
    suggestedFilename,
    resultColor,
    resultBorder,
  }
}
