import { desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpActionPlan, pdtpPrograms } from "@/db/schema"
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

  const activityRows = await db.select({ id: pdtpActivities.id }).from(pdtpActivities)
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

  // El cumplimiento se mide por cantidad comprometida, no por el mero hecho
  // de que una actividad tenga al menos una ejecución durante el mes.
  const plannedByMonth = Array.from({ length: 12 }, () => 0)
  for (const row of scheduleRows) {
    plannedByMonth[row.month - 1]! += row.plannedQuantity
  }

  const executedByMonth = Array.from({ length: 12 }, () => 0)
  for (const row of approvedExecutionRows) {
    executedByMonth[row.month - 1]! += row.executedQuantity
  }

  const monthly: PdtpComplianceMonth[] = Array.from({ length: 12 }, (_, i) => {
    const planned = plannedByMonth[i]!
    // Sobreejecutar es real y se muestra completo (principio 5.2: "conservar
    // el real y marcar sobrecumplimiento sin caparlo silenciosamente"); antes
    // se recortaba `executed` a `planned` aquí, ocultando el dato agregado
    // (el crudo en pdtpExecutions nunca se tocó). `percent` puede superar 1 —
    // los consumidores (ComplianceBar, fmtPct) ya clampan solo la barra
    // visual, no el texto ni el número.
    const executed = executedByMonth[i]!
    const percent = planned > 0 ? Math.round((executed / planned) * 100) / 100 : null
    return { month: i + 1, planned, executed, percent }
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
