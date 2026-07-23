import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpActionPlan, pdtpActivityWorksiteParams, pdtpPrograms, workers } from "@/db/schema"
import { PDTP_ESTADOS_CERRADOS } from "./checklist-domain"
import { loadProgramScheduleAndExecutions } from "./helpers"

export type PdtpComplianceMonth = {
  month: number
  planned: number
  executed: number
  /** Fracción 0-1 (no 0-100): se compara directo contra `complianceTarget`,
   * que también es fracción. Distinto de `PdtpSheetView.monthlyTotals[].percent`
   * (entero 0-100) — no mezclar los dos sin convertir. */
  percent: number | null
}

export type PdtpComplianceIndicators = {
  programId: string
  year: number
  target: number
  monthly: PdtpComplianceMonth[]
  quarterly: Array<{ quarter: number; planned: number; executed: number; percent: number | null }>
  annual: { planned: number; executed: number; percent: number | null }
  /** Última `updatedAt` entre las ejecuciones aprobadas que componen el
   * indicador, o `null` si no hay ninguna todavía. No es la hora del
   * cálculo (eso es "corte", ver `asOf` en el caller) sino de los datos. */
  lastExecutionUpdatedAt: string | null
}

export async function getPdtpComplianceIndicators(yearOrProgramId: number | string, worksiteId?: string): Promise<PdtpComplianceIndicators | null> {
  let program: typeof pdtpPrograms.$inferSelect | null = null

  if (typeof yearOrProgramId === "string") {
    const [found] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, yearOrProgramId)).limit(1)
    program = found ?? null
  } else {
    const programs = await db.select().from(pdtpPrograms)
      .where(eq(pdtpPrograms.year, yearOrProgramId)).orderBy(desc(pdtpPrograms.version)).limit(10)
    program = programs.find((p) => p.status === "active") ?? programs[0] ?? null
  }

  if (!program) return null
  const year = program.year

  const activityRows = await db.select({ id: pdtpActivities.id, indicatorMode: pdtpActivities.indicatorMode }).from(pdtpActivities)
    .where(eq(pdtpActivities.programId, program.id))

  if (activityRows.length === 0) {
    return {
      programId: program.id, year, target: program.complianceTarget,
      monthly: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, planned: 0, executed: 0, percent: null })),
      quarterly: Array.from({ length: 4 }, (_, i) => ({ quarter: i + 1, planned: 0, executed: 0, percent: null })),
      annual: { planned: 0, executed: 0, percent: null },
      lastExecutionUpdatedAt: null,
    }
  }

  const allActivityIds = activityRows.map((row) => row.id)
  const { scheduleRows, executionRows } = await loadProgramScheduleAndExecutions(allActivityIds, year, worksiteId)
  // El cumplimiento formal solo incorpora ejecuciones validadas. Las
  // submitted siguen visibles en el tablero operativo y en aprobaciones.
  const approvedExecutionRows = executionRows.filter((row) => row.status === "approved")

  // Modo de indicador por actividad: 'coverage' se calcula todo-o-nada; el resto
  // se capa en lo planificado (R3). El cómputo es por actividad-mes para poder
  // aplicar reglas distintas por actividad y no dejar que una compense a otra.
  const modeByActivity = new Map(activityRows.map((a) => [a.id, a.indicatorMode]))

  // Padrón por actividad (R1/R2, respuesta 1 del cuestionario 2026-07): meta de
  // cobertura = trabajadores esperados de la faena. Solo se conoce con faena
  // explícita. Prioridad: parámetro cargado a mano → dotación activa de la faena
  // (inferida) → cantidad planificada del mes.
  const expectedByActivity = new Map<string, number>()
  let activeWorkerCount = 0
  if (worksiteId) {
    const hasCoverage = activityRows.some((a) => a.indicatorMode === "coverage")
    const [paramRows, workerCountRow] = await Promise.all([
      db.select({ activityId: pdtpActivityWorksiteParams.activityId, expectedSubjectCount: pdtpActivityWorksiteParams.expectedSubjectCount })
        .from(pdtpActivityWorksiteParams)
        .where(and(inArray(pdtpActivityWorksiteParams.activityId, allActivityIds), eq(pdtpActivityWorksiteParams.worksiteId, worksiteId))),
      // Solo se cuenta la dotación si hay actividades de cobertura (evita el query de más).
      hasCoverage
        ? db.select({ count: sql<number>`count(*)::int` }).from(workers).where(and(eq(workers.worksiteId, worksiteId), eq(workers.isActive, true)))
        : Promise.resolve([{ count: 0 }]),
    ])
    for (const row of paramRows) {
      if (row.expectedSubjectCount != null) expectedByActivity.set(row.activityId, row.expectedSubjectCount)
    }
    activeWorkerCount = workerCountRow[0]?.count ?? 0
  }

  const plannedByActivityMonth = new Map<string, number>()
  for (const row of scheduleRows) {
    const key = `${row.activityId}:${row.month}`
    plannedByActivityMonth.set(key, (plannedByActivityMonth.get(key) ?? 0) + row.plannedQuantity)
  }
  const executedByActivityMonth = new Map<string, number>()
  for (const row of approvedExecutionRows) {
    const key = `${row.activityId}:${row.month}`
    executedByActivityMonth.set(key, (executedByActivityMonth.get(key) ?? 0) + row.executedQuantity)
  }

  const monthly: PdtpComplianceMonth[] = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1
    // Actividades de cobertura: todo o nada por actividad (respuesta 2.2).
    let coveragePlanned = 0
    let coverageExecuted = 0
    // Resto de actividades: el techo de sobrecumplimiento se aplica al TOTAL del
    // mes (respuesta 2.4 = "por mes"), permitiendo que una actividad compense a
    // otra dentro del mismo mes.
    let restPlanned = 0
    let restRawExecuted = 0
    for (const activityId of allActivityIds) {
      const p = plannedByActivityMonth.get(`${activityId}:${month}`) ?? 0
      const rawExecuted = executedByActivityMonth.get(`${activityId}:${month}`) ?? 0
      if (modeByActivity.get(activityId) === "coverage") {
        // Cobertura solo cuenta en los meses en que está programada. Meta = padrón
        // esperado de la faena (o lo planificado si no hay padrón cargado); solo
        // cuenta si se alcanza al 100 %, sin crédito parcial.
        if (p === 0) continue
        // Padrón manual → dotación activa inferida (si hay) → planificado.
        const target = expectedByActivity.get(activityId) ?? (activeWorkerCount > 0 ? activeWorkerCount : p)
        coveragePlanned += target
        coverageExecuted += rawExecuted >= target && target > 0 ? target : 0
      } else {
        // Resto: se agrupa por total del mes (respuesta 2.4 = "por mes"), sin
        // condicionar el ejecutado a que la misma actividad tuviera planificado
        // ese mes — así una actividad puede compensar a otra dentro del mes.
        restPlanned += p
        restRawExecuted += rawExecuted
      }
    }
    const planned = coveragePlanned + restPlanned
    const executed = coverageExecuted + Math.min(restRawExecuted, restPlanned)
    const percent = planned > 0 ? Math.round((executed / planned) * 100) / 100 : null
    return { month, planned, executed, percent }
  })

  const quarterly = Array.from({ length: 4 }, (_, q) => {
    const months = monthly.slice(q * 3, q * 3 + 3)
    const planned = months.reduce((s, m) => s + m.planned, 0)
    const executed = months.reduce((s, m) => s + m.executed, 0)
    const percent = planned > 0 ? Math.round((executed / planned) * 100) / 100 : null
    return { quarter: q + 1, planned, executed, percent }
  })

  const annualPlanned = monthly.reduce((s, m) => s + m.planned, 0)
  const annualExecuted = monthly.reduce((s, m) => s + m.executed, 0)
  const annual = {
    planned: annualPlanned, executed: annualExecuted,
    percent: annualPlanned > 0 ? Math.round((annualExecuted / annualPlanned) * 100) / 100 : null,
  }

  const lastExecutionUpdatedAt = approvedExecutionRows.reduce<string | null>((latest, row) => {
    return !latest || row.updatedAt > latest ? row.updatedAt : latest
  }, null)

  return { programId: program.id, year, target: program.complianceTarget, monthly, quarterly, annual, lastExecutionUpdatedAt }
}

/**
 * Agrega el indicador de cumplimiento sobre varias faenas autorizadas (por
 * ejemplo, todas las que ve un usuario global) reutilizando el cálculo
 * por-faena ya correcto, en vez de omitir `worksiteId` — omitirlo deja
 * `executed` en 0 aunque exista avance real (UX-01). Falla cerrado: sin
 * faenas explícitas no hay agregado.
 */
export async function getPdtpComplianceIndicatorsForScope(
  yearOrProgramId: number | string,
  worksiteIds: string[],
): Promise<(PdtpComplianceIndicators & { worksiteCount: number }) | null> {
  if (worksiteIds.length === 0) return null
  const perWorksite = await Promise.all(worksiteIds.map((id) => getPdtpComplianceIndicators(yearOrProgramId, id)))
  const resolved = perWorksite.filter((x): x is PdtpComplianceIndicators => x !== null)
  if (resolved.length === 0) return null

  const monthly: PdtpComplianceMonth[] = Array.from({ length: 12 }, (_, i) => {
    const planned = resolved.reduce((sum, entry) => sum + entry.monthly[i]!.planned, 0)
    const executed = resolved.reduce((sum, entry) => sum + entry.monthly[i]!.executed, 0)
    return { month: i + 1, planned, executed, percent: planned > 0 ? Math.round((executed / planned) * 100) / 100 : null }
  })
  const quarterly = Array.from({ length: 4 }, (_, q) => {
    const months = monthly.slice(q * 3, q * 3 + 3)
    const planned = months.reduce((s, m) => s + m.planned, 0)
    const executed = months.reduce((s, m) => s + m.executed, 0)
    return { quarter: q + 1, planned, executed, percent: planned > 0 ? Math.round((executed / planned) * 100) / 100 : null }
  })
  const annualPlanned = monthly.reduce((s, m) => s + m.planned, 0)
  const annualExecuted = monthly.reduce((s, m) => s + m.executed, 0)
  const lastExecutionUpdatedAt = resolved.reduce<string | null>((latest, entry) => {
    return entry.lastExecutionUpdatedAt && (!latest || entry.lastExecutionUpdatedAt > latest) ? entry.lastExecutionUpdatedAt : latest
  }, null)

  return {
    programId: resolved[0]!.programId,
    year: resolved[0]!.year,
    target: resolved[0]!.target,
    monthly,
    quarterly,
    annual: { planned: annualPlanned, executed: annualExecuted, percent: annualPlanned > 0 ? Math.round((annualExecuted / annualPlanned) * 100) / 100 : null },
    lastExecutionUpdatedAt,
    worksiteCount: worksiteIds.length,
  }
}

/* ── Cumplimiento integral (3 ejes: ejecución + verificación + cierre) ────── */

export type PdtpIntegralComplianceAxes = {
  ejecucion: number | null   // 0-1: ejecutado / planificado
  verificacion: number | null // 0-100: % items cumple del checklist
  cierre: number | null      // 0-100: % acciones cerradas
}

export type PdtpIntegralCompliance = PdtpIntegralComplianceAxes & {
  programId: string
  year: number
  integral: number | null     // 0-100: ponderado
  pesos: { ejecucion: number; verificacion: number; cierre: number }
}

/**
 * Calcula el cumplimiento integral del programa: 0.5*ejec + 0.3*verif + 0.2*cierre.
 * Los pesos vienen de pdtpPrograms (defaults 0.5/0.3/0.2).
 */
export async function getPdtpIntegralCompliance(
  yearOrProgramId: number | string,
  worksiteId?: string,
): Promise<PdtpIntegralCompliance | null> {
  let program: typeof pdtpPrograms.$inferSelect | null = null

  if (typeof yearOrProgramId === "string") {
    const [found] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, yearOrProgramId)).limit(1)
    program = found ?? null
  } else {
    const programs = await db.select().from(pdtpPrograms)
      .where(eq(pdtpPrograms.year, yearOrProgramId)).orderBy(desc(pdtpPrograms.version)).limit(10)
    program = programs.find((p) => p.status === "active") ?? programs[0] ?? null
  }
  if (!program) return null

  // Eje 1: ejecución (reutiliza el cálculo existente)
  const base = await getPdtpComplianceIndicators(program.id, worksiteId)
  const ejecucion = base?.annual.percent ?? null

  // Obtener todas las ejecuciones válidas del programa/faena
  const activityRows = await db.select({ id: pdtpActivities.id }).from(pdtpActivities)
    .where(eq(pdtpActivities.programId, program.id))
  const activityIds = activityRows.map((r) => r.id)

  let verificacion: number | null = null
  let cierre: number | null = null

  if (activityIds.length > 0) {
    const { executionRows } = await loadProgramScheduleAndExecutions(activityIds, program.year, worksiteId)
    // El indicador integral es formal: checklist y acciones también requieren
    // que la ejecución base haya sido aprobada.
    const approvedExecutionIds = executionRows.reduce<string[]>((ids, execution) => {
      if (execution.status === "approved") ids.push(execution.id)
      return ids
    }, [])

    if (approvedExecutionIds.length > 0) {
      // Eje 2: verificación — promedio de porcentajeCumplimiento de las instancias
      const instances = await db.query.pdtpExecutionChecklists.findMany({
        where: (t, { inArray: ia }) => ia(t.executionId, approvedExecutionIds),
      })
      const validPct = instances
        .map((i) => i.porcentajeCumplimiento)
        .filter((p): p is number => p !== null)
      if (validPct.length > 0) {
        verificacion = Math.round((validPct.reduce((s, p) => s + p, 0) / validPct.length) * 100) / 100
      }

      // Eje 3: cierre — acciones cerradas / total
      const actions = await db.select({ estado: pdtpActionPlan.estado, plazo: pdtpActionPlan.plazo })
        .from(pdtpActionPlan).where(inArray(pdtpActionPlan.executionId, approvedExecutionIds))
      if (actions.length > 0) {
        const cerradas = actions.filter((a) => PDTP_ESTADOS_CERRADOS.has(a.estado)).length
        cierre = Math.round((cerradas / actions.length) * 10000) / 100
      }
    }
  }

  // Integral ponderado
  const pesos = {
    ejecucion: program.pesoEjecucion,
    verificacion: program.pesoVerificacion,
    cierre: program.pesoCierre,
  }
  let integral: number | null = null
  if (ejecucion !== null || verificacion !== null || cierre !== null) {
    const e = (ejecucion ?? 0) * 100
    const v = verificacion ?? 0
    const c = cierre ?? 0
    integral = Math.round((pesos.ejecucion * e + pesos.verificacion * v + pesos.cierre * c) * 100) / 100
  }

  return {
    programId: program.id,
    year: program.year,
    ejecucion, verificacion, cierre,
    integral,
    pesos,
  }
}
