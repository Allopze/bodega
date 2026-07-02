import { desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpPrograms } from "@/db/schema"
import { loadProgramScheduleAndExecutions } from "./helpers"

export type PdtpComplianceMonth = {
  month: number
  planned: number
  executed: number
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

export async function getPdtpComplianceIndicators(year: number, worksiteId?: string): Promise<PdtpComplianceIndicators | null> {
  const programs = await db.select().from(pdtpPrograms)
    .where(eq(pdtpPrograms.year, year)).orderBy(desc(pdtpPrograms.version)).limit(10)
  const program = programs.find((p) => p.status === "active") ?? programs[0]
  if (!program) return null

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
