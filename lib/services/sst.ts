/**
 * lib/services/sst.ts
 * SST module — all DB-backed business logic.
 * No Server Actions, no UI imports.
 */

import { z } from 'zod'
import { eq, and, inArray, desc, sql, count } from 'drizzle-orm'
import { db, type Tx } from '@/db'
import {
  sstEvaluations,
  sstResponses,
  sstScheduledFollowups,
  sstActionPlan,
  type SstEvaluation,
} from '@/db/schema/sst'
import { workers, worksites } from '@/db/schema/worksites'
import { nanoid } from '@/lib/id'
import { addDays } from '@/lib/sst/date'
import { getDefinition } from '@/lib/sst/definitions/index'
import { getApplicableItems } from '@/lib/sst/checklist'
import {
  calculateCompliance,
  getAutomaticResultadoFinal,
  classifyEfficacy,
} from '@/lib/sst/compliance'
import {
  sstEvaluationCreateSchema,
  sstResponsesBatchSchema,
  sstCloseEvaluationSchema,
  sstFollowupMarkSchema,
  sstActionPlanItemSchema,
} from '@/lib/validation/sst'
import type { StatusValue } from '@/lib/sst/types'

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * assertEditable — throw if evaluation not found or is cerrado.
 * DS N°44/2024 immutability requirement.
 */
async function assertEditable(evaluationId: string, tx?: Tx): Promise<void> {
  const client = tx ?? db
  const rows = await client
    .select({ estado: sstEvaluations.estado })
    .from(sstEvaluations)
    .where(eq(sstEvaluations.id, evaluationId))
    .limit(1)

  if (rows.length === 0) {
    throw new Error('Evaluación no encontrada.')
  }
  if (rows[0].estado === 'cerrado') {
    throw new Error(
      'Esta evaluación está cerrada y no puede ser modificada. Las actas cerradas son inmutables por requerimiento legal (DS N°44/2024).'
    )
  }
}

// ── createEvaluation ──────────────────────────────────────────────────────────

export async function createEvaluation(
  input: z.infer<typeof sstEvaluationCreateSchema>,
  userId: string
): Promise<SstEvaluation> {
  const data = sstEvaluationCreateSchema.parse(input)

  const id = nanoid()
  const now = new Date().toISOString()

  const newRow: typeof sstEvaluations.$inferInsert = {
    id,
    worksiteId:             data.worksiteId,
    workerId:               data.workerId,
    createdBy:              userId,
    definicionCode:         data.definicionCode,
    definicionVersion:      '01', // TODO: derive from definition registry instead of hardcoding
    tipo:                   data.tipo,
    motivo:                 data.motivo ?? null,
    motivoOtro:             data.motivoOtro ?? null,
    descripcionEvento:      data.descripcionEvento ?? null,
    equipoPatente:          data.equipoPatente ?? null,
    fechaEvaluacion:        data.fechaEvaluacion,
    estado:                 'borrador',
    cargosJson:             data.cargos,
    resultadoFinal:         null,
    porcentajeCumplimiento: null,
    resultadoEficacia:      null,
    restricciones:          null,
    observacionesGenerales: null,
    schemaJson:             null,
    createdAt:              now,
    updatedAt:              now,
  }

  await db.transaction(async (tx) => {
    await tx.insert(sstEvaluations).values(newRow)

    if (data.tipo === 'seguimiento') {
      const instancias: Array<{ instancia: string; days: number }> = [
        { instancia: 'dia_0',  days: 0  },
        { instancia: 'dia_7',  days: 7  },
        { instancia: 'dia_15', days: 15 },
        { instancia: 'dia_30', days: 30 },
      ]
      for (const { instancia, days } of instancias) {
        await tx.insert(sstScheduledFollowups).values({
          id:              nanoid(),
          evaluationId:    id,
          instancia,
          fechaProgramada: addDays(data.fechaEvaluacion, days),
          cumple:          null,
          observaciones:   null,
          realizado:       false,
        })
      }
    }
  })

  const [evaluation] = await db
    .select()
    .from(sstEvaluations)
    .where(eq(sstEvaluations.id, id))
    .limit(1)

  return evaluation
}

// ── getEvaluation ─────────────────────────────────────────────────────────────

export async function getEvaluation(
  id: string,
  worksiteIds: string[] | 'all'
): Promise<SstEvaluation | null> {
  if (worksiteIds !== 'all' && worksiteIds.length === 0) return null

  const [evaluation] = await db
    .select()
    .from(sstEvaluations)
    .where(eq(sstEvaluations.id, id))
    .limit(1)

  if (!evaluation) return null
  if (worksiteIds !== 'all' && !worksiteIds.includes(evaluation.worksiteId)) return null

  return evaluation
}

// ── listEvaluations ───────────────────────────────────────────────────────────

export async function listEvaluations(
  filters: {
    worksiteIds: string[] | 'all'
    tipo?: string
    estado?: string
    workerId?: string
  },
  limit = 50,
  offset = 0
): Promise<(SstEvaluation & { workerName: string; worksiteName: string })[]> {
  if (filters.worksiteIds !== 'all' && filters.worksiteIds.length === 0) return []

  const conditions = []

  if (filters.worksiteIds !== 'all') {
    conditions.push(inArray(sstEvaluations.worksiteId, filters.worksiteIds))
  }
  if (filters.tipo) {
    conditions.push(eq(sstEvaluations.tipo, filters.tipo))
  }
  if (filters.estado) {
    conditions.push(eq(sstEvaluations.estado, filters.estado))
  }
  if (filters.workerId) {
    conditions.push(eq(sstEvaluations.workerId, filters.workerId))
  }

  const rows = await db
    .select({
      // evaluation columns
      id:                     sstEvaluations.id,
      worksiteId:             sstEvaluations.worksiteId,
      workerId:               sstEvaluations.workerId,
      createdBy:              sstEvaluations.createdBy,
      definicionCode:         sstEvaluations.definicionCode,
      definicionVersion:      sstEvaluations.definicionVersion,
      tipo:                   sstEvaluations.tipo,
      motivo:                 sstEvaluations.motivo,
      motivoOtro:             sstEvaluations.motivoOtro,
      descripcionEvento:      sstEvaluations.descripcionEvento,
      equipoPatente:          sstEvaluations.equipoPatente,
      fechaEvaluacion:        sstEvaluations.fechaEvaluacion,
      estado:                 sstEvaluations.estado,
      cargosJson:             sstEvaluations.cargosJson,
      resultadoFinal:         sstEvaluations.resultadoFinal,
      porcentajeCumplimiento: sstEvaluations.porcentajeCumplimiento,
      resultadoEficacia:      sstEvaluations.resultadoEficacia,
      restricciones:          sstEvaluations.restricciones,
      observacionesGenerales: sstEvaluations.observacionesGenerales,
      schemaJson:             sstEvaluations.schemaJson,
      createdAt:              sstEvaluations.createdAt,
      updatedAt:              sstEvaluations.updatedAt,
      // joined columns
      workerFirstName: workers.firstName,
      workerLastName:  workers.lastName,
      worksiteName:    worksites.name,
    })
    .from(sstEvaluations)
    .leftJoin(workers,   eq(sstEvaluations.workerId,   workers.id))
    .leftJoin(worksites, eq(sstEvaluations.worksiteId, worksites.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(sstEvaluations.createdAt))
    .limit(limit)
    .offset(offset)

  return rows.map((r) => ({
    id:                     r.id,
    worksiteId:             r.worksiteId,
    workerId:               r.workerId,
    createdBy:              r.createdBy,
    definicionCode:         r.definicionCode,
    definicionVersion:      r.definicionVersion,
    tipo:                   r.tipo,
    motivo:                 r.motivo,
    motivoOtro:             r.motivoOtro,
    descripcionEvento:      r.descripcionEvento,
    equipoPatente:          r.equipoPatente,
    fechaEvaluacion:        r.fechaEvaluacion,
    estado:                 r.estado,
    cargosJson:             r.cargosJson,
    resultadoFinal:         r.resultadoFinal,
    porcentajeCumplimiento: r.porcentajeCumplimiento,
    resultadoEficacia:      r.resultadoEficacia,
    restricciones:          r.restricciones,
    observacionesGenerales: r.observacionesGenerales,
    schemaJson:             r.schemaJson,
    createdAt:              r.createdAt,
    updatedAt:              r.updatedAt,
    workerName:    `${r.workerFirstName ?? ''} ${r.workerLastName ?? ''}`.trim(),
    worksiteName:  r.worksiteName ?? '',
  }))
}

// ── saveResponses ─────────────────────────────────────────────────────────────

export async function saveResponses(
  evaluationId: string,
  responses: z.infer<typeof sstResponsesBatchSchema>,
  worksiteIds: string[] | 'all'
): Promise<void> {
  if (worksiteIds !== 'all' && worksiteIds.length === 0)
    throw new Error('Evaluación no encontrada o sin acceso.')

  const evaluation = await getEvaluation(evaluationId, worksiteIds)
  if (!evaluation) throw new Error('Evaluación no encontrada o sin acceso.')

  const data = sstResponsesBatchSchema.parse(responses)

  await db.transaction(async (tx) => {
    await assertEditable(evaluationId, tx)

    for (const resp of data) {
      // Check if a response already exists for this (evaluationId, seccionId, itemId)
      const existing = await tx
        .select({ id: sstResponses.id })
        .from(sstResponses)
        .where(
          and(
            eq(sstResponses.evaluationId, resp.evaluationId),
            eq(sstResponses.seccionId,    resp.seccionId),
            eq(sstResponses.itemId,       resp.itemId)
          )
        )
        .limit(1)

      if (existing.length > 0) {
        await tx
          .update(sstResponses)
          .set({
            estado:           resp.estado ?? null,
            observacion:      resp.observacion ?? null,
            accionCorrectiva: resp.accionCorrectiva ?? null,
          })
          .where(eq(sstResponses.id, existing[0].id))
      } else {
        await tx.insert(sstResponses).values({
          id:               nanoid(),
          evaluationId:     resp.evaluationId,
          seccionId:        resp.seccionId,
          itemId:           resp.itemId,
          estado:           resp.estado ?? null,
          observacion:      resp.observacion ?? null,
          accionCorrectiva: resp.accionCorrectiva ?? null,
        })
      }
    }
  })
}

// ── closeEvaluation ───────────────────────────────────────────────────────────

export async function closeEvaluation(
  id: string,
  input: z.infer<typeof sstCloseEvaluationSchema>,
  worksiteIds: string[] | 'all'
): Promise<SstEvaluation> {
  const evaluation = await getEvaluation(id, worksiteIds)
  if (!evaluation) throw new Error('Evaluación no encontrada o sin acceso.')

  // Idempotent: already cerrado → return as-is
  if (evaluation.estado === 'cerrado') return evaluation

  const data = sstCloseEvaluationSchema.parse(input)

  // Load responses
  const allResponses = await db
    .select()
    .from(sstResponses)
    .where(eq(sstResponses.evaluationId, id))

  // Get definition and applicable items
  const definition = getDefinition(evaluation.definicionCode, evaluation.definicionVersion)
  const cargos = (evaluation.cargosJson as string[]) ?? []
  const applicableItems = getApplicableItems(definition, cargos)

  // Build a set of applicable (seccionId, itemId) pairs
  const applicableSet = new Set(
    applicableItems.map((ai) => `${ai.seccionId}::${ai.item.id}`)
  )

  // Filter responses to only applicable items
  const applicableResponses = allResponses.filter((r) =>
    applicableSet.has(`${r.seccionId}::${r.itemId}`)
  )

  const complianceInput = applicableResponses.map((r) => ({
    estado: r.estado as StatusValue,
  }))

  const { percentage } = calculateCompliance(complianceInput)

  const responsesForResultado = applicableResponses.map((r) => ({
    seccionId: r.seccionId,
    itemId:    r.itemId,
    estado:    r.estado as StatusValue,
  }))

  const resultadoFinal = getAutomaticResultadoFinal(
    evaluation.definicionCode,
    percentage,
    responsesForResultado,
    data.hasCriticalDeviation ?? false,
    data.hasReincidence ?? false
  )

  // resultadoEficacia only for LC-SST-002
  let resultadoEficacia: string | null = null
  if (evaluation.definicionCode === 'LC-SST-002') {
    const efficacy = classifyEfficacy(
      percentage,
      data.hasCriticalDeviation ?? false,
      data.hasReincidence ?? false
    )
    resultadoEficacia = efficacy.classification
  }

  const schemaJson = JSON.stringify(definition)
  const now = new Date().toISOString()

  await db
    .update(sstEvaluations)
    .set({
      estado:                 'cerrado',
      porcentajeCumplimiento: percentage,
      resultadoFinal,
      resultadoEficacia,
      restricciones:          data.restricciones ?? null,
      observacionesGenerales: data.observacionesGenerales ?? null,
      schemaJson,
      updatedAt:              now,
    })
    .where(eq(sstEvaluations.id, id))

  const [updated] = await db
    .select()
    .from(sstEvaluations)
    .where(eq(sstEvaluations.id, id))
    .limit(1)

  if (!updated) throw new Error('Evaluation not found after update')

  return updated
}

// ── markFollowup ──────────────────────────────────────────────────────────────

export async function markFollowup(
  followupId: string,
  input: z.infer<typeof sstFollowupMarkSchema>,
  worksiteIds: string[] | 'all'
): Promise<void> {
  const [followup] = await db
    .select()
    .from(sstScheduledFollowups)
    .where(eq(sstScheduledFollowups.id, followupId))
    .limit(1)

  if (!followup) throw new Error('Seguimiento no encontrado.')

  // Scope check via evaluation (allowed even when cerrado)
  const evaluation = await getEvaluation(followup.evaluationId, worksiteIds)
  if (!evaluation) throw new Error('Evaluación no encontrada o sin acceso.')

  const data = sstFollowupMarkSchema.parse(input)

  await db
    .update(sstScheduledFollowups)
    .set({
      realizado:    data.realizado,
      cumple:       data.cumple,
      observaciones: data.observaciones ?? null,
    })
    .where(eq(sstScheduledFollowups.id, followupId))
}

// ── getFollowups ──────────────────────────────────────────────────────────────

export async function getFollowups(
  evaluationId: string,
  worksiteIds: string[] | 'all'
): Promise<typeof sstScheduledFollowups.$inferSelect[]> {
  const evaluation = await getEvaluation(evaluationId, worksiteIds)
  if (!evaluation) throw new Error('Evaluación no encontrada o sin acceso.')

  return db
    .select()
    .from(sstScheduledFollowups)
    .where(eq(sstScheduledFollowups.evaluationId, evaluationId))
}

// ── saveActionPlanItem ────────────────────────────────────────────────────────

export async function saveActionPlanItem(
  input: z.infer<typeof sstActionPlanItemSchema>,
  worksiteIds: string[] | 'all'
): Promise<typeof sstActionPlan.$inferSelect> {
  const data = sstActionPlanItemSchema.parse(input)

  await assertEditable(data.evaluationId)

  // Scope check
  const evaluation = await getEvaluation(data.evaluationId, worksiteIds)
  if (!evaluation) throw new Error('Evaluación no encontrada o sin acceso.')

  // Upsert by (evaluationId, n)
  const existing = await db
    .select({ id: sstActionPlan.id })
    .from(sstActionPlan)
    .where(
      and(
        eq(sstActionPlan.evaluationId, data.evaluationId),
        eq(sstActionPlan.n, data.n)
      )
    )
    .limit(1)

  if (existing.length > 0) {
    await db
      .update(sstActionPlan)
      .set({
        hallazgo:    data.hallazgo,
        accion:      data.accion,
        responsable: data.responsable,
        plazo:       data.plazo,
        estado:      data.estado,
      })
      .where(eq(sstActionPlan.id, existing[0].id))

    const [updated] = await db
      .select()
      .from(sstActionPlan)
      .where(eq(sstActionPlan.id, existing[0].id))
      .limit(1)
    return updated
  } else {
    const newId = nanoid()
    await db.insert(sstActionPlan).values({
      id:           newId,
      evaluationId: data.evaluationId,
      n:            data.n,
      hallazgo:     data.hallazgo,
      accion:       data.accion,
      responsable:  data.responsable,
      plazo:        data.plazo,
      estado:       data.estado,
    })

    const [inserted] = await db
      .select()
      .from(sstActionPlan)
      .where(eq(sstActionPlan.id, newId))
      .limit(1)
    return inserted
  }
}

// ── deleteActionPlanItem ──────────────────────────────────────────────────────

export async function deleteActionPlanItem(
  id: string,
  worksiteIds: string[] | 'all'
): Promise<void> {
  const [item] = await db
    .select({ evaluationId: sstActionPlan.evaluationId })
    .from(sstActionPlan)
    .where(eq(sstActionPlan.id, id))
    .limit(1)

  if (!item) throw new Error('Ítem del plan de acción no encontrado.')

  await assertEditable(item.evaluationId)

  // Scope check
  const evaluation = await getEvaluation(item.evaluationId, worksiteIds)
  if (!evaluation) throw new Error('Evaluación no encontrada o sin acceso.')

  await db.delete(sstActionPlan).where(eq(sstActionPlan.id, id))
}

// ── getDashboardStats ─────────────────────────────────────────────────────────

export async function getDashboardStats(
  worksiteIds: string[] | 'all'
): Promise<{
  total: number
  borrador: number
  cerrado: number
  habilitados: number
  noHabilitados: number
  pendingFollowups: number
}> {
  if (worksiteIds !== 'all' && worksiteIds.length === 0) {
    return { total: 0, borrador: 0, cerrado: 0, habilitados: 0, noHabilitados: 0, pendingFollowups: 0 }
  }

  const scopeCond = worksiteIds !== 'all'
    ? inArray(sstEvaluations.worksiteId, worksiteIds)
    : undefined

  const [statsRow] = await db
    .select({
      total:         count(),
      borrador:      sql<number>`COUNT(*) FILTER (WHERE ${sstEvaluations.estado} = 'borrador')`,
      cerrado:       sql<number>`COUNT(*) FILTER (WHERE ${sstEvaluations.estado} = 'cerrado')`,
      habilitados:   sql<number>`COUNT(*) FILTER (WHERE ${sstEvaluations.resultadoFinal} IN ('habilitado_autonomo', 'habilitado_restricciones'))`,
      noHabilitados: sql<number>`COUNT(*) FILTER (WHERE ${sstEvaluations.resultadoFinal} = 'no_habilitado')`,
    })
    .from(sstEvaluations)
    .where(scopeCond)

  const followupScopeCond = worksiteIds !== 'all'
    ? inArray(sstEvaluations.worksiteId, worksiteIds)
    : undefined

  const [followupsRow] = await db
    .select({ pending: count() })
    .from(sstScheduledFollowups)
    .innerJoin(sstEvaluations, eq(sstScheduledFollowups.evaluationId, sstEvaluations.id))
    .where(
      followupScopeCond
        ? and(eq(sstScheduledFollowups.realizado, false), followupScopeCond)
        : eq(sstScheduledFollowups.realizado, false)
    )

  return {
    total:            Number(statsRow?.total         ?? 0),
    borrador:         Number(statsRow?.borrador       ?? 0),
    cerrado:          Number(statsRow?.cerrado        ?? 0),
    habilitados:      Number(statsRow?.habilitados    ?? 0),
    noHabilitados:    Number(statsRow?.noHabilitados  ?? 0),
    pendingFollowups: Number(followupsRow?.pending    ?? 0),
  }
}
