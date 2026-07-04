export type PdtpPeriod = {
  year: number
  month: number
  week: number
}

export type PdtpActivityStatus = "pending" | "executed" | "overdue" | "not_scheduled"

/**
 * Compute the current PDTP period (year, month, week).
 * Week is calculated as: day 1-7 → week 1, day 8-14 → week 2, day 15-21 → week 3, day 22-31 → week 4
 * This matches how pdtpActivitySchedule and pdtpExecutions bucket planned/executed activities.
 */
export function currentPdtpPeriod(now: Date = new Date()): PdtpPeriod {
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const day = now.getDate()
  const week = Math.min(4, Math.ceil(day / 7))

  return { year, month, week }
}

/**
 * Derive the status of a single activity for a given period.
 *
 * Status rules:
 * - 'not_scheduled': nothing planned this month (monthlyPlanned[month - 1] is 0 or undefined)
 * - 'executed': something executed this month (monthlyExecuted[month - 1] > 0)
 * - 'overdue': planned in an earlier month with nothing executed
 * - 'pending': planned this month, not executed, no earlier unexecuted months
 */
export function deriveActivityStatus(
  monthlyPlanned: number[],
  monthlyExecuted: number[],
  period: PdtpPeriod,
): PdtpActivityStatus {
  const currentMonthPlanned = monthlyPlanned[period.month - 1] ?? 0
  const currentMonthExecuted = monthlyExecuted[period.month - 1] ?? 0

  // If nothing planned this month
  if (currentMonthPlanned === 0 || currentMonthPlanned === undefined) {
    return "not_scheduled"
  }

  // If something executed this month
  if (currentMonthExecuted > 0) {
    return "executed"
  }

  // Check if there are any earlier unexecuted planned months
  for (let i = 0; i < period.month - 1; i++) {
    const planned = monthlyPlanned[i] ?? 0
    const executed = monthlyExecuted[i] ?? 0
    if (planned > 0 && executed === 0) {
      return "overdue"
    }
  }

  // Planned this month, not executed, no earlier unexecuted months
  return "pending"
}
