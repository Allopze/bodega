import { and, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpActivities,
  pdtpActivityWorksiteParams,
  pdtpExecutions,
  pdtpPrograms,
  preventionCapaActions,
  preventionInspectionFindings,
  preventionInspectionRuns,
} from "@/db/schema"
import { PDTP_ESTADOS_CERRADOS } from "./checklist-domain"
import { capaEstado } from "./capa-view"
import { loadApprovedExecutionsForWorksites, loadProgramScheduleAndExecutions } from "./helpers"
import { isFlowSubjectSource, resolvePdtpSubjectCount } from "./subject-registry"
import { filterPdtpRowsFromActivation } from "./period"

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

type ApprovedExecution = Awaited<ReturnType<typeof loadProgramScheduleAndExecutions>>["executionRows"][number]

/**
 * Una ejecución manual/XLS y la integración de una inspección pueden describir
 * el mismo trabajo. Por celda semanal se toma la mayor cobertura entre ambas
 * fuentes alternativas; otras integraciones siguen sumando porque representan
 * mecanismos distintos (capacitación, EPP, etc.).
 */
function effectiveApprovedExecutions(rows: ApprovedExecution[]) {
  const cells = new Map<string, {
    activityId: string
    month: number
    inspectionQuantity: number
    legacyQuantity: number
    otherIntegrationQuantity: number
  }>()
  for (const row of rows) {
    const key = `${row.activityId}:${row.worksiteId}:${row.year}:${row.month}:${row.week}`
    const cell = cells.get(key) ?? {
      activityId: row.activityId,
      month: row.month,
      inspectionQuantity: 0,
      legacyQuantity: 0,
      otherIntegrationQuantity: 0,
    }
    if (row.origin === "integration" && row.sourceType === "inspeccion") {
      cell.inspectionQuantity += row.executedQuantity
    } else if (row.origin === "integration") {
      cell.otherIntegrationQuantity += row.executedQuantity
    } else {
      cell.legacyQuantity += row.executedQuantity
    }
    cells.set(key, cell)
  }
  return [...cells.values()].map((cell) => ({
    activityId: cell.activityId,
    month: cell.month,
    executedQuantity: Math.max(cell.inspectionQuantity, cell.legacyQuantity)
      + cell.otherIntegrationQuantity,
  }))
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

  const activityRows = await db.select({
    id: pdtpActivities.id,
    indicatorMode: pdtpActivities.indicatorMode,
    subjectSource: pdtpActivities.subjectSource,
  }).from(pdtpActivities)
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
  const loaded = await loadProgramScheduleAndExecutions(allActivityIds, year, worksiteId)
  const scheduleRows = filterPdtpRowsFromActivation(loaded.scheduleRows, program.activatedAt)
  const executionRows = filterPdtpRowsFromActivation(loaded.executionRows, program.activatedAt)
  // El cumplimiento formal solo incorpora ejecuciones validadas. Las
  // submitted siguen visibles en el tablero operativo y en aprobaciones.
  const approvedExecutionRows = executionRows.filter((row) => row.status === "approved")
  const effectiveExecutionRows = effectiveApprovedExecutions(approvedExecutionRows)

  // Modo de indicador por actividad: 'coverage' se calcula todo-o-nada; el resto
  // se capa en lo planificado (R3). El cómputo es por actividad-mes para poder
  // aplicar reglas distintas por actividad y no dejar que una compense a otra.
  const modeByActivity = new Map(activityRows.map((a) => [a.id, a.indicatorMode]))

  /**
   * Padrón por actividad. La cadena es: **override manual → padrón derivado del
   * registro de sujetos → cantidad planificada del mes**.
   *
   * El derivado es lo nuevo (`subject_source`): el padrón deja de ser un número
   * que alguien teclea y pasa a leerse de donde los sujetos ya viven —la
   * dotación, el inventario de extintores, los expuestos de un GES—. Un número
   * guardado envejece; una consulta no.
   *
   * Se conserva el override porque sigue habiendo sujetos sin registro propio, y
   * gana sobre lo derivado: si alguien lo cargó a mano, sabe algo que la consulta
   * no.
   *
   * Un registro vacío **no** es un padrón de cero: se cae a lo planificado. Con
   * cero, la actividad aportaría 0 al denominador y desaparecería del cómputo,
   * que es exactamente el sesgo que premia el no configurar. Que una faena no
   * tenga extintores se declara excluyendo la actividad (R4).
   */
  const expectedByActivity = new Map<string, number>()
  const coverageTargetPctByActivity = new Map<string, number>()
  /** Padrón derivado. Las fuentes de stock se resuelven una vez; las de flujo, por mes. */
  const derivedStockByActivity = new Map<string, number>()
  const derivedFlowByActivityMonth = new Map<string, number>()
  const sourceByActivity = new Map<string, string | null>(activityRows.map((a) => [a.id, a.subjectSource]))

  if (worksiteId) {
    const paramRows = await db.select({
      activityId: pdtpActivityWorksiteParams.activityId,
      expectedSubjectCount: pdtpActivityWorksiteParams.expectedSubjectCount,
      targetCoveragePercent: pdtpActivityWorksiteParams.targetCoveragePercent,
    })
      .from(pdtpActivityWorksiteParams)
      .where(and(inArray(pdtpActivityWorksiteParams.activityId, allActivityIds), eq(pdtpActivityWorksiteParams.worksiteId, worksiteId)))
    for (const row of paramRows) {
      if (row.expectedSubjectCount != null) expectedByActivity.set(row.activityId, row.expectedSubjectCount)
      if (row.targetCoveragePercent != null) coverageTargetPctByActivity.set(row.activityId, Number(row.targetCoveragePercent))
    }

    // Sólo se consulta el registro de las actividades que de verdad miden por
    // cobertura, declaran fuente y no tienen override: lo demás sería trabajo de
    // más sobre un dato que no se va a usar.
    const needDerived = activityRows.filter((a) => a.indicatorMode === "coverage"
      && a.subjectSource !== null
      && !expectedByActivity.has(a.id))

    for (const activity of needDerived) {
      if (isFlowSubjectSource(activity.subjectSource)) {
        for (let month = 1; month <= 12; month++) {
          const count = await resolvePdtpSubjectCount(activity.subjectSource, worksiteId, { year, month })
          if (count != null && count > 0) derivedFlowByActivityMonth.set(`${activity.id}:${month}`, count)
        }
        continue
      }
      const count = await resolvePdtpSubjectCount(activity.subjectSource, worksiteId, { year, month: 1 })
      if (count != null && count > 0) derivedStockByActivity.set(activity.id, count)
    }
  }

  /** Padrón efectivo de una celda actividad-mes, o `null` si no hay ninguno. */
  const padronFor = (activityId: string, month: number): number | null => {
    const manual = expectedByActivity.get(activityId)
    if (manual != null) return manual
    const flow = derivedFlowByActivityMonth.get(`${activityId}:${month}`)
    if (flow != null) return flow
    return derivedStockByActivity.get(activityId) ?? null
  }

  const plannedByActivityMonth = new Map<string, number>()
  for (const row of scheduleRows) {
    const key = `${row.activityId}:${row.month}`
    plannedByActivityMonth.set(key, (plannedByActivityMonth.get(key) ?? 0) + row.plannedQuantity)
  }
  const executedByActivityMonth = new Map<string, number>()
  for (const row of effectiveExecutionRows) {
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
        const derived = padronFor(activityId, month)
        // Una fuente de stock se barre según calendario, así que sin planificación
        // en el mes no hay nada que exigir. Una de flujo es al revés: el
        // denominador son los casos que ocurrieron, y ocurren cuando ocurren — la
        // N°18 no tiene calendario y aun así debe contar el mes que entró gente.
        const esFlujo = isFlowSubjectSource(sourceByActivity.get(activityId) ?? null)
        if (p === 0 && !(esFlujo && derived != null)) continue
        // Override manual → padrón derivado → cantidad planificada. Sin ninguno,
        // se mide por lo planificado y no contra una población inventada.
        const target = derived ?? p
        // R2: `targetCoveragePercent` baja el umbral de acreditación sin tocar el
        // denominador — con meta 90 % y padrón 50, acreditan 45 ejecuciones y el
        // aporte sigue siendo 50/50. Sin meta configurada se exige el padrón
        // completo, que es el comportamiento histórico.
        const targetPct = coverageTargetPctByActivity.get(activityId)
        const threshold = targetPct != null ? Math.ceil((target * targetPct) / 100) : target
        coveragePlanned += target
        coverageExecuted += threshold > 0 && rawExecuted >= threshold ? target : 0
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
): Promise<(PdtpComplianceIndicators & {
  worksiteCount: number
  /** Desglose por faena, en el mismo orden que `worksiteIds`. Se expone para que
   * un consumidor que necesita el agregado *y* la comparativa por faena (el
   * tablero) no tenga que volver a calcular lo mismo N veces. */
  perWorksite: Array<{ worksiteId: string; indicators: PdtpComplianceIndicators | null }>
}) | null> {
  if (worksiteIds.length === 0) return null
  const perWorksiteResults = await Promise.all(worksiteIds.map((id) => getPdtpComplianceIndicators(yearOrProgramId, id)))
  const perWorksite = worksiteIds.map((worksiteId, index) => ({ worksiteId, indicators: perWorksiteResults[index] ?? null }))
  const resolved = perWorksiteResults.filter((x): x is PdtpComplianceIndicators => x !== null)
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
    perWorksite,
  }
}

export type PdtpCategoryCompliance = {
  /** Eje del sistema de gestión: `pdtpActivities.program`. */
  category: string
  planned: number
  executed: number
  percent: number | null
}

/**
 * Avance por eje SG-SST sobre las faenas autorizadas. Se calcula con las mismas
 * reglas que el indicador mensual —solo ejecuciones aprobadas y techo de
 * sobrecumplimiento— pero agrupando por `program` en vez de por mes.
 *
 * Las actividades de cobertura quedan **fuera**: se puntúan todo-o-nada contra
 * un padrón, así que sumarlas aquí mezclaría dos unidades. La regla vive en
 * `getPdtpComplianceIndicators` y duplicarla en dos sitios es pedir que diverjan.
 */
export async function getPdtpComplianceByCategoryForScope(
  programId: string,
  worksiteIds: string[],
): Promise<PdtpCategoryCompliance[] | null> {
  if (worksiteIds.length === 0) return null
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) return null

  const activityRows = await db.select({
    id: pdtpActivities.id,
    program: pdtpActivities.program,
    indicatorMode: pdtpActivities.indicatorMode,
  }).from(pdtpActivities).where(eq(pdtpActivities.programId, program.id))

  const scorable = activityRows.filter((row) => row.indicatorMode !== "coverage")
  if (scorable.length === 0) return []
  const categoryByActivity = new Map(scorable.map((row) => [row.id, row.program || "General"]))

  const loaded = await loadApprovedExecutionsForWorksites(
    scorable.map((row) => row.id),
    program.year,
    worksiteIds,
  )
  const scheduleRows = filterPdtpRowsFromActivation(loaded.scheduleRows, program.activatedAt)
  const executionRows = filterPdtpRowsFromActivation(loaded.executionRows, program.activatedAt)

  const totals = new Map<string, { planned: number; executed: number }>()
  const bump = (activityId: string, field: "planned" | "executed", amount: number) => {
    const category = categoryByActivity.get(activityId)
    if (!category) return
    const entry = totals.get(category) ?? { planned: 0, executed: 0 }
    entry[field] += amount
    totals.set(category, entry)
  }
  for (const row of scheduleRows) bump(row.activityId, "planned", row.plannedQuantity)
  for (const row of effectiveApprovedExecutions(executionRows)) {
    bump(row.activityId, "executed", row.executedQuantity)
  }

  return [...totals.entries()]
    .map(([category, { planned, executed }]) => {
      // Mismo techo que el cálculo mensual: sobrecumplir no sube del 100 %.
      const capped = Math.min(executed, planned)
      return {
        category,
        planned,
        executed: capped,
        percent: planned > 0 ? Math.round((capped / planned) * 100) / 100 : null,
      }
    })
    .sort((a, b) => b.planned - a.planned)
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
 * Ejes 2 y 3 sobre un conjunto de ejecuciones aprobadas. Vive aparte porque
 * tanto la versión por faena como la agregada tienen que calcularlos **sobre las
 * filas crudas**: `verificacion` es un promedio y `cierre` un ratio, así que
 * promediar los resultados por faena daría un número distinto (y equivocado)
 * cuando las faenas tienen distinto número de checklists o de acciones.
 *
 * Dos motores alimentan estos ejes:
 *  · checklists del PDTP (`pdtp_execution_checklists` + `pdtp_action_plan`);
 *  · inspecciones del motor transversal, alcanzadas por la ejecución que
 *    acreditaron (`origin='integration'`, `sourceType='inspeccion'`,
 *    `sourceId=runId`). Antes sólo se leía el primero, así que una faena que
 *    trabajara en el motor de inspecciones aparecía con verificación y cierre
 *    en null y perdía los dos ejes del índice integral.
 */
async function computeVerificacionYCierre(approvedExecutionIds: string[]): Promise<{
  verificacion: number | null
  cierre: number | null
}> {
  if (approvedExecutionIds.length === 0) return { verificacion: null, cierre: null }

  const [instances, actions, inspectionRows] = await Promise.all([
    db.query.pdtpExecutionChecklists.findMany({
      where: (t, { inArray: ia }) => ia(t.executionId, approvedExecutionIds),
    }),
    // D11: el estado de la acción vive en su CAPA. Leer el espejo daba un %
    // congelado cuando la acción se avanzaba desde la pantalla de CAPA.
    db.select({ estado: preventionCapaActions.status })
      .from(preventionCapaActions).where(and(
        eq(preventionCapaActions.sourceType, "pdtp"),
        inArray(preventionCapaActions.sourceId, approvedExecutionIds),
      )),
    db.select({
      runId: preventionInspectionRuns.id,
      compliancePercent: preventionInspectionRuns.compliancePercent,
    })
      .from(pdtpExecutions)
      .innerJoin(preventionInspectionRuns, eq(preventionInspectionRuns.id, pdtpExecutions.sourceId))
      .where(and(
        inArray(pdtpExecutions.id, approvedExecutionIds),
        eq(pdtpExecutions.sourceType, "inspeccion"),
      )),
  ])

  // El cierre real del hallazgo vive en su CAPA, no en su propia columna: hoy
  // `preventionInspectionFindings.status` nunca llega a 'closed' (sólo hay
  // escritor para 'capa_linked'), así que leerla sola daría 0 % siempre.
  const inspectionRunIds = inspectionRows.map((row) => row.runId)
  const findings = inspectionRunIds.length > 0
    ? await db.select({
        status: preventionInspectionFindings.status,
        capaStatus: preventionCapaActions.status,
      })
        .from(preventionInspectionFindings)
        .leftJoin(preventionCapaActions, eq(preventionCapaActions.id, preventionInspectionFindings.capaActionId))
        .where(inArray(preventionInspectionFindings.runId, inspectionRunIds))
    : []

  const validPct = [
    ...instances.map((instance) => instance.porcentajeCumplimiento),
    ...inspectionRows.map((row) => row.compliancePercent),
  ].filter((pct): pct is number => pct !== null)
  const verificacion = validPct.length > 0
    ? Math.round((validPct.reduce((sum, pct) => sum + pct, 0) / validPct.length) * 100) / 100
    : null

  // Mismo criterio para las dos fuentes: cuenta como cerrado lo que quedó
  // verificado o cerrado. Un hallazgo sin CAPA enlazada está abierto.
  const findingCerrado = (f: { status: string; capaStatus: string | null }) =>
    f.status === "closed" || f.capaStatus === "closed" || f.capaStatus === "verified"
  const cerrados = actions.filter((a) => PDTP_ESTADOS_CERRADOS.has(capaEstado(a.estado))).length
    + findings.filter(findingCerrado).length
  const totalCierre = actions.length + findings.length
  const cierre = totalCierre > 0
    ? Math.round((cerrados / totalCierre) * 10000) / 100
    : null

  return { verificacion, cierre }
}

function weightIntegral(
  program: typeof pdtpPrograms.$inferSelect,
  axes: PdtpIntegralComplianceAxes,
): PdtpIntegralCompliance {
  const pesos = {
    ejecucion: program.pesoEjecucion,
    verificacion: program.pesoVerificacion,
    cierre: program.pesoCierre,
  }
  let integral: number | null = null
  if (axes.ejecucion !== null || axes.verificacion !== null || axes.cierre !== null) {
    const e = (axes.ejecucion ?? 0) * 100
    const v = axes.verificacion ?? 0
    const c = axes.cierre ?? 0
    integral = Math.round((pesos.ejecucion * e + pesos.verificacion * v + pesos.cierre * c) * 100) / 100
  }
  return { programId: program.id, year: program.year, ...axes, integral, pesos }
}

/**
 * Cumplimiento integral agregado sobre las faenas autorizadas del usuario, para
 * el tablero cuando no hay una faena elegida. No es el promedio de los
 * integrales por faena: los tres ejes se agregan a nivel de filas.
 */
export async function getPdtpIntegralComplianceForScope(
  programId: string,
  worksiteIds: string[],
): Promise<PdtpIntegralCompliance | null> {
  if (worksiteIds.length === 0) return null
  const [program] = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) return null

  const scoped = await getPdtpComplianceIndicatorsForScope(program.id, worksiteIds)
  const ejecucion = scoped?.annual.percent ?? null

  const activityRows = await db.select({ id: pdtpActivities.id }).from(pdtpActivities)
    .where(eq(pdtpActivities.programId, program.id))
  const loaded = await loadApprovedExecutionsForWorksites(
    activityRows.map((row) => row.id),
    program.year,
    worksiteIds,
  )
  const executionRows = filterPdtpRowsFromActivation(loaded.executionRows, program.activatedAt)
  const { verificacion, cierre } = await computeVerificacionYCierre(executionRows.map((row) => row.id))

  return weightIntegral(program, { ejecucion, verificacion, cierre })
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

  let approvedExecutionIds: string[] = []
  if (activityIds.length > 0) {
    const loaded = await loadProgramScheduleAndExecutions(activityIds, program.year, worksiteId)
    const executionRows = filterPdtpRowsFromActivation(loaded.executionRows, program.activatedAt)
    // El indicador integral es formal: checklist y acciones también requieren
    // que la ejecución base haya sido aprobada.
    approvedExecutionIds = executionRows.reduce<string[]>((ids, execution) => {
      if (execution.status === "approved") ids.push(execution.id)
      return ids
    }, [])
  }
  const { verificacion, cierre } = await computeVerificacionYCierre(approvedExecutionIds)

  return weightIntegral(program, { ejecucion, verificacion, cierre })
}
