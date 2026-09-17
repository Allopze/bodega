import { chileDateParts } from "@/lib/utils"

export type PdtpPeriod = {
  year: number
  month: number
  week: number
}

/**
 * `not_performed` no es "sin ejecución": es "sin ejecución **con un motivo
 * declarado**" (un desvío `not_performed` activo en el mes, ver
 * `deviations.ts`). El planificado sigue en pie y la actividad sigue contando
 * en cero para el indicador; lo que cambia es que la faena ya explicó por qué,
 * así que no se la sigue tratando como deuda silenciosa.
 */
export type PdtpActivityStatus = "pending" | "executed" | "overdue" | "not_scheduled" | "not_performed"

/**
 * Filtro de estado del visor de actividades: los cuatro estados reales de
 * `PdtpActivityStatus` más `"en_cero"`, un filtro compuesto (no un estado
 * nuevo) que corresponde exactamente a lo que
 * `PdtpComplianceMonth.zeroActivityIds` cuenta en `compliance.ts` — ver
 * `isPdtpActivityZeroThisMonth` más abajo.
 */
export type PdtpActivityStatusFilter = PdtpActivityStatus | "en_cero"

type PdtpPeriodRow = {
  year: number
  month: number
  week: number
}

/**
 * Compute the current PDTP period (year, month, week).
 * Week is calculated as: day 1-7 → week 1, day 8-14 → week 2, day 15-21 → week 3, day 22-31 → week 4
 * This matches how pdtpActivitySchedule and pdtpExecutions bucket planned/executed activities.
 */
export function currentPdtpPeriod(now: Date = new Date()): PdtpPeriod {
  // Hora de Chile, no la del proceso: en producción corre en UTC y el período
  // saltaba de mes (y de año) 3–4 horas antes que la faena.
  const { year, month, day } = chileDateParts(now)
  const week = Math.min(4, Math.ceil(day / 7))

  return { year, month, week }
}

/**
 * El PDTP se vuelve exigible cuando se activa la versión ya aprobada. Como el
 * calendario firmado solo tiene granularidad mes/semana, la semana de
 * activación se conserva completa: todavía puede ejecutarse durante ese mismo
 * bloque; únicamente salen las celdas de semanas anteriores.
 *
 * `activatedAt = null` conserva el comportamiento histórico de programas
 * importados que ya estaban activos antes de que se registrara esta huella.
 */
export function isPdtpPeriodOnOrAfterActivation(
  period: PdtpPeriodRow,
  activatedAt: string | null | undefined,
): boolean {
  const activationPeriod = pdtpActivationPeriod(activatedAt)
  if (!activationPeriod) return true
  if (period.year !== activationPeriod.year) return period.year > activationPeriod.year
  if (period.month !== activationPeriod.month) return period.month > activationPeriod.month
  return period.week >= activationPeriod.week
}

export function pdtpActivationPeriod(activatedAt: string | null | undefined): PdtpPeriod | null {
  if (!activatedAt) return null
  const activationDate = new Date(activatedAt)
  return Number.isNaN(activationDate.getTime()) ? null : currentPdtpPeriod(activationDate)
}

/** Excluye del cómputo las obligaciones anteriores a la activación. */
export function filterPdtpRowsFromActivation<T extends PdtpPeriodRow>(
  rows: T[],
  activatedAt: string | null | undefined,
): T[] {
  return activatedAt
    ? rows.filter((row) => isPdtpPeriodOnOrAfterActivation(row, activatedAt))
    : rows
}

/**
 * Cuántos desvíos `not_performed` activos tiene la actividad en cada mes
 * (índice 0 = enero). Lo arma `sheets.ts` a partir de `deviationRows` de la
 * costura única; omitirlo deja el comportamiento previo a los desvíos.
 */
export type PdtpActivityStatusOptions = { monthlyNotPerformed?: number[] }

/** Un mes con un "no realizada" declarado ya está explicado: no es deuda muda. */
function hasDeclaredNotPerformed(options: PdtpActivityStatusOptions | undefined, monthIndex: number): boolean {
  return (options?.monthlyNotPerformed?.[monthIndex] ?? 0) > 0
}

/**
 * Derive the status of a single activity for a given period.
 *
 * Status rules:
 * - 'not_scheduled': nothing planned this month (monthlyPlanned[month - 1] is 0 or undefined)
 * - 'executed': something executed this month (monthlyExecuted[month - 1] > 0)
 * - 'not_performed': nada ejecutado este mes, pero hay un desvío "no
 *   realizada" activo que declara el motivo (`options.monthlyNotPerformed`)
 * - 'overdue': planned in an earlier month with nothing executed
 * - 'pending': planned this month, not executed, no earlier unexecuted months
 *
 * Una ejecución gana sobre la declaración: si el mes tiene ejecutado > 0 el
 * estado es `executed` aunque quede un desvío colgando (de hecho
 * `markPdtpExecution` retira el `not_performed` al registrar cantidad > 0).
 *
 * Un mes **anterior** con un `not_performed` declarado no produce `overdue`:
 * la deuda está explicada y la actividad no se arrastra como atrasada mes a
 * mes por algo que ya tiene motivo registrado. Lo que no cambia es el
 * indicador: `compliance.ts` sigue contando esa celda en cero (el planificado
 * no se toca), y este estado sólo describe cómo se muestra.
 */
export function deriveActivityStatus(
  monthlyPlanned: number[],
  monthlyExecuted: number[],
  period: PdtpPeriod,
  options?: PdtpActivityStatusOptions,
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

  if (hasDeclaredNotPerformed(options, period.month - 1)) {
    return "not_performed"
  }

  // Check if there are any earlier unexecuted planned months
  for (let i = 0; i < period.month - 1; i++) {
    const planned = monthlyPlanned[i] ?? 0
    const executed = monthlyExecuted[i] ?? 0
    if (planned > 0 && executed === 0 && !hasDeclaredNotPerformed(options, i)) {
      return "overdue"
    }
  }

  // Planned this month, not executed, no earlier unexecuted months
  return "pending"
}

/**
 * Count how many past months have planned but zero executed activity.
 * Used to derive badge severity (e.g. "Atrasado · 2 meses").
 * Returns 0 if status is not "overdue".
 *
 * Misma regla que `deriveActivityStatus`: un mes con "no realizada" declarada
 * no engrosa el contador — si lo hiciera, el badge diría "Atrasado · 2 meses"
 * sobre meses que el propio badge de estado ya dejó de considerar atrasados.
 */
export function countOverdueMonths(
  monthlyPlanned: number[],
  monthlyExecuted: number[],
  period: PdtpPeriod,
  options?: PdtpActivityStatusOptions,
): number {
  let count = 0
  for (let i = 0; i < period.month - 1; i++) {
    const planned = monthlyPlanned[i] ?? 0
    const executed = monthlyExecuted[i] ?? 0
    if (planned > 0 && executed === 0 && !hasDeclaredNotPerformed(options, i)) count++
  }
  return count
}

/**
 * "En cero" en el mes de `period`: la actividad tenía planificación ese mes
 * y ninguna ejecución **aprobada**. Es exactamente el criterio de
 * `PdtpComplianceMonth.zeroActivityIds` en `compliance.ts` (rama "resto" del
 * bucle mensual: `p > 0 && rawExecuted === 0`, y `rawExecuted` ahí solo suma
 * `approvedExecutionRows`), llevado al visor de actividades para que el
 * enlace del indicador muestre lo mismo que cuenta.
 *
 * `pending` y `overdue` son ambos "cero ejecución este mes" para
 * `deriveActivityStatus` — la única diferencia entre ellos es si además hay
 * un mes *anterior* con el mismo hueco — así que "en cero" es su unión.
 *
 * `coverage` y `closed_on_time` quedan excluidos, igual que en
 * `compliance.ts`: tienen su propia regla todo-o-nada y un cero ahí significa
 * "no se acreditó el padrón/plazo", no "no se hizo nada".
 *
 * `approvedMonthlyExecuted` **debe** venir filtrado a solo `status ===
 * "approved"` — no pasar `effectiveMonthlyExecuted` de `PdtpSheetView`, que
 * cuenta cualquier estado (`submitted` incluida) y es correcto para la tabla
 * pero no para este filtro: una ejecución enviada y aún sin aprobar sigue
 * siendo "en cero" para el indicador, aunque la tabla ya la muestre como
 * hecha. Este desacople causó un bug real (ronda 2/5, tarea 1.4): el filtro
 * excluía actividades que el indicador seguía contando en cero.
 *
 * **No recibe `monthlyNotPerformed` a propósito**: un desvío "no realizada"
 * declara el motivo pero no toca el planificado, así que la actividad sigue
 * en cero para `compliance.ts` (`zeroActivityIds`). Pasarle las opciones
 * haría que el filtro "En cero" del visor dejara de mostrar justamente las
 * actividades que el indicador cuenta — el desacople que este helper existe
 * para evitar.
 */
export function isPdtpActivityZeroThisMonth(
  activity: { indicatorMode?: string | null },
  monthlyPlanned: number[],
  approvedMonthlyExecuted: number[],
  period: PdtpPeriod,
): boolean {
  if (activity.indicatorMode === "coverage" || activity.indicatorMode === "closed_on_time") return false
  const status = deriveActivityStatus(monthlyPlanned, approvedMonthlyExecuted, period)
  return status === "pending" || status === "overdue"
}
