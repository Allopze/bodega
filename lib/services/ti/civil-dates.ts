import { todayInChile } from "@/lib/utils"

function civilDayNumber(value: string): number {
  const [year = 0, month = 1, day = 1] = value.split("-").map(Number)
  return Date.UTC(year, month - 1, day) / 86_400_000
}

/** Returns target - base in whole civil days, without parsing YYYY-MM-DD as UTC. */
export function civilDaysUntil(target: string, base = todayInChile()): number {
  return Math.round(civilDayNumber(target) - civilDayNumber(base))
}

export function isCivilDateBefore(value: string, base = todayInChile()): boolean {
  return civilDaysUntil(value, base) < 0
}
