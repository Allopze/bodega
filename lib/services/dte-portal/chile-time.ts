/**
 * Calendario operacional de las sincronizaciones DTE.
 *
 * El host puede ejecutar en UTC durante una recuperación o un test. Por eso
 * los períodos y slots nunca deben depender de `Date#getMonth()` local.
 */

export const DTE_OPERATION_TIME_ZONE = "America/Santiago"

const PARTS_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: DTE_OPERATION_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

export interface ChileClock {
  date: string
  period: string
  minutesSinceMidnight: number
}

export function chileClock(at = new Date()): ChileClock {
  const parts = Object.fromEntries(
    PARTS_FORMATTER.formatToParts(at)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute", string>

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    period: `${parts.year}-${parts.month}`,
    minutesSinceMidnight: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

export function chilePeriod(at = new Date()): string {
  return chileClock(at).period
}

/** Previous calendar month, crossing year boundaries. */
export function previousChilePeriod(period: string): string {
  const [year, month] = period.split("-").map(Number) as [number, number]
  const previousMonth = month === 1 ? 12 : month - 1
  const previousYear = month === 1 ? year - 1 : year
  return `${previousYear}-${String(previousMonth).padStart(2, "0")}`
}

export interface CronSlot {
  label: string
  minutesSinceMidnight: number
}

export interface DueCronSlot extends CronSlot {
  /** Local calendar identity, safe to use as a notification dedupe key. */
  id: string
  /** Milliseconds from this instant back to the due time. */
  elapsedMs: number
}

/**
 * Finds the most recent due slot only while its bounded evaluation window is
 * open. This avoids treating the normal overnight gap as a failed cron.
 */
export function dueCronSlot(
  slots: readonly CronSlot[],
  at = new Date(),
  windowMinutes = 20,
): DueCronSlot | null {
  const clock = chileClock(at)
  const eligible = slots
    .filter((slot) => clock.minutesSinceMidnight >= slot.minutesSinceMidnight)
    .sort((a, b) => b.minutesSinceMidnight - a.minutesSinceMidnight)[0]
  if (!eligible) return null

  const elapsedMinutes = clock.minutesSinceMidnight - eligible.minutesSinceMidnight
  if (elapsedMinutes > windowMinutes) return null

  const hour = String(Math.floor(eligible.minutesSinceMidnight / 60)).padStart(2, "0")
  const minute = String(eligible.minutesSinceMidnight % 60).padStart(2, "0")
  return {
    ...eligible,
    id: `${clock.date}T${hour}:${minute}`,
    elapsedMs: elapsedMinutes * 60_000 + at.getSeconds() * 1_000 + at.getMilliseconds(),
  }
}
