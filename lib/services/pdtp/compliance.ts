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
    }
  }

  const allActivityIds = activityRows.map((row) => row.id)
  const { scheduleRows, executionRows } = await loadProgramScheduleAndExecutions(allActivityIds, year, worksiteId)
  const validExecutionRows = executionRows.filter((row) => row.status === "submitted" || row.status === "approved")

  const plannedByMonth = Array.from({ length: 12 }, () => new Set<string>())
  for (const row of scheduleRows) {
    if (row.plannedQuantity > 0) plannedByMonth[row.month - 1]!.add(row.activityId)
  }

  const executedByMonth = Array.from({ length: 12 }, () => new Set<string>())
  for (const row of validExecutionRows) {
    if (row.executedQuantity > 0) executedByMonth[row.month - 1]!.add(row.activityId)
  }

  const monthly: PdtpComplianceMonth[] = Array.from({ length: 12 }, (_, i) => {
    const planned = plannedByMonth[i]!.size
    const executed = executedByMonth[i]!.size
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

  return { programId: program.id, year, target: program.complianceTarget, monthly, quarterly, annual }
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
    const validExecutions = executionRows.filter((r) => r.status === "submitted" || r.status === "approved")
    const executionIds = validExecutions.map((r) => r.id)

    if (executionIds.length > 0) {
      // Eje 2: verificación — promedio de porcentajeCumplimiento de las instancias
      const instances = await db.query.pdtpExecutionChecklists.findMany({
        where: (t, { inArray: ia }) => ia(t.executionId, executionIds),
      })
      const validPct = instances
        .map((i) => i.porcentajeCumplimiento)
        .filter((p): p is number => p !== null)
      if (validPct.length > 0) {
        verificacion = Math.round((validPct.reduce((s, p) => s + p, 0) / validPct.length) * 100) / 100
      }

      // Eje 3: cierre — acciones cerradas / total
      const actions = await db.select({ estado: pdtpActionPlan.estado, plazo: pdtpActionPlan.plazo })
        .from(pdtpActionPlan).where(inArray(pdtpActionPlan.executionId, executionIds))
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
