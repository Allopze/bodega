import { COPEC_COVERAGE_ACCOUNTS, isTerminalCopecCoverage } from "@/lib/combustibles/copec-coverage"
import { MONTH_LABELS, MONTH_NAMES, addDaysToPlainDate, formatQty } from "@/lib/utils"

/**
 * Mapa de cobertura de las fuentes de Combustible por mes (CHART-022): la
 * derivación del estado de cada celda, sin base de datos ni pantalla.
 *
 * Antes de creer cualquier gráfico de combustible hay que saber si el mes está
 * completo. Cada fuente lo dice a su manera —Copec cierra el mes por cuenta
 * (`fuel_provider_period_coverage`), la telemetría y la sincronización de OnWay
 * llegan por día—, así que hay una función por forma de llegar y las dos
 * contestan lo mismo: completo, parcial, sin datos, en curso o no aplica.
 *
 * Regla de fondo, la misma de `monthsWithoutProviderData`: un mes sin datos del
 * proveedor es un **hueco**, no un cero. Un mes en curso nunca se pinta como una
 * caída, pero tampoco se esconde detrás de «en curso» cuando ya debió haber datos.
 */
export type CoverageStatus = "ok" | "partial" | "missing" | "upcoming" | "na"

export interface CoverageCell {
  status: CoverageStatus
  /** Lo que sostiene el estado («128 filas, 19.040 L», «27 de 31 días con datos»). */
  detail?: string
}

export interface CoverageRow {
  id: string
  label: string
  cells: CoverageCell[]
}

export const COVERAGE_MONTHS = 12

/** `YYYY-MM` del día `YYYY-MM-DD`. */
const monthOf = (day: string) => day.slice(0, 7)

function addMonth(monthKey: string, delta: number): string {
  const total = Number(monthKey.slice(0, 4)) * 12 + (Number(monthKey.slice(5, 7)) - 1) + delta
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`
}

/** Último día civil de un mes `YYYY-MM`. */
const lastDayOf = (monthKey: string) => addDaysToPlainDate(`${addMonth(monthKey, 1)}-01`, -1)

/** Los últimos `count` meses, terminando en el mes de `today` (hora de Chile), del más antiguo al más nuevo. */
export function coverageWindow(today: string, count = COVERAGE_MONTHS): string[] {
  const current = monthOf(today)
  return Array.from({ length: count }, (_, index) => addMonth(current, index - count + 1))
}

/** Rótulos de columna: «Oct»; con el año («Ene 26») en la primera columna y en cada enero. */
export function coverageColumns(months: readonly string[]): Array<{ key: string; label: string; title: string }> {
  return months.map((month, index) => {
    const number = Number(month.slice(5, 7))
    const withYear = index === 0 || number === 1
    return {
      key: month,
      label: `${MONTH_LABELS[number - 1]}${withYear ? ` ${month.slice(2, 4)}` : ""}`,
      title: `${capitalize(MONTH_NAMES[number - 1] ?? month)} ${month.slice(0, 4)}`,
    }
  })
}

const capitalize = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`
const liters = (value: number) => `${formatQty(value, undefined, { maximumFractionDigits: 0 })} L`
const count = (value: number, one: string, many: string) => `${formatQty(value)} ${value === 1 ? one : many}`

/* ── Copec: el mes se cierra por cuenta ─────────────────────────────────── */

export interface CopecCoverageMonthRow {
  sourceAccount: string
  status: string
  rowsAccepted: number
  quantityTotal: number
}

/**
 * Una celda de un canal de Copec (tarjeta de equipos `TCT`, abastecimiento de
 * estanques `TAE`) en un mes.
 *
 * - **Completo**: las cuentas del canal (diésel y BlueMax) tienen cobertura
 *   terminal (`complete` o `legitimate_empty`) — la misma vara con que
 *   `isCopecMonthClosed` cierra los cuatro.
 * - **Parcial**: hay filas aceptadas, pero el mes no está cerrado: la cifra
 *   existe y no es un cero inventado, pero tampoco está certificada.
 * - **Sin datos**: ni filas ni cierre. Es el hueco del proveedor.
 * - **En curso**: el mes actual (o uno futuro): se recalcula en cada corrida.
 * - **No aplica**: antes de la primera cobertura del canal (`firstMonth`).
 *
 * `rows` son las filas de cobertura del canal en ese mes; las de otro canal se
 * ignoran, así que un canal cerrado no cierra al otro.
 */
export function copecChannelCell(input: {
  channel: "TCT" | "TAE"
  month: string
  today: string
  /** Primer mes (`YYYY-MM`) con alguna fila de cobertura del canal, o `null` si nunca hubo. */
  firstMonth: string | null
  rows: readonly CopecCoverageMonthRow[]
}): CoverageCell {
  const { channel, month, today, firstMonth } = input
  if (firstMonth === null || month < firstMonth) return { status: "na", detail: "la integración aún no leía este canal" }

  const accounts = COPEC_COVERAGE_ACCOUNTS.filter((account) => account.startsWith(`${channel.toLowerCase()}:`))
  const rows = input.rows.filter((row) => accounts.includes(row.sourceAccount))
  const accepted = rows.reduce((total, row) => total + row.rowsAccepted, 0)
  const quantity = rows.reduce((total, row) => total + row.quantityTotal, 0)
  const figures = `${count(accepted, "fila", "filas")}, ${liters(quantity)}`

  if (month >= monthOf(today)) {
    return { status: "upcoming", detail: accepted > 0 ? `${figures} hasta ahora` : "sin datos todavía" }
  }
  const closed = accounts.every((account) => rows.some((row) => row.sourceAccount === account && isTerminalCopecCoverage(row.status)))
  if (closed) return { status: "ok", detail: accepted > 0 ? figures : "cerrado sin movimientos" }
  if (accepted > 0) return { status: "partial", detail: `${figures}, sin cerrar` }
  return {
    status: "missing",
    detail: rows.some((row) => row.status === "failed") ? "la última lectura del proveedor falló" : "sin datos del proveedor",
  }
}

/* ── Fuentes diarias: días con datos contra días esperados ──────────────── */

/**
 * Una celda de una fuente que llega por día (telemetría de equipos, sincronización
 * de OnWay): cuántos días del mes trajeron datos contra cuántos debieron.
 *
 * - Los días esperados van desde el primer día con datos de la fuente (si empezó
 *   a mitad de mes) hasta el fin del mes, o **hasta ayer** en el mes en curso:
 *   hoy todavía está llegando. Sin ningún día esperado (el primero del mes), el
 *   mes queda «en curso».
 * - `completeRatio` es la parte de los días esperados que hace un mes completo.
 *   La telemetría de un equipo no informa los días que no operó, así que tolera
 *   algunos (0,9); una sincronización debe correr todos los días (1).
 * - A diferencia de Copec, el mes en curso **sí** se juzga: una fuente caída
 *   desde hace días no se disfraza de «en curso».
 */
export function dailySourceCell(input: {
  month: string
  today: string
  /** Primer día (`YYYY-MM-DD`) con datos de la fuente, o `null` si nunca hubo. */
  firstDay: string | null
  /** Días distintos del mes con datos. */
  daysWithData: number
  completeRatio: number
  /** Cómo se dice un día bueno: «con datos», «con sincronización». */
  unit: string
  /** Complemento del detalle («6 equipos, 8.400 L»). */
  extra?: string
}): CoverageCell {
  const { month, today, firstDay } = input
  if (firstDay === null || month < monthOf(firstDay)) return { status: "na", detail: "la fuente aún no traía datos" }

  const monthStart = `${month}-01`
  const start = firstDay > monthStart ? firstDay : monthStart
  const yesterday = addDaysToPlainDate(today, -1)
  const monthEnd = lastDayOf(month)
  const end = monthEnd < yesterday ? monthEnd : yesterday
  const expected = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1
  const current = month >= monthOf(today)
  if (expected <= 0) return { status: "upcoming", detail: "todavía no hay un día completo que esperar" }

  const withData = Math.min(Math.max(input.daysWithData, 0), expected)
  const needed = Math.max(1, Math.ceil(expected * input.completeRatio - 1e-9))
  const status: CoverageStatus = withData === 0 ? "missing" : withData >= needed ? "ok" : "partial"
  const detail = `${withData} de ${expected} días ${input.unit}${input.extra ? `, ${input.extra}` : ""}${current ? ", hasta ayer" : ""}`
  return { status, detail }
}

/* ── La frase que responde ──────────────────────────────────────────────── */

/**
 * «Hay huecos en 2 de 4 fuentes: …»: las fuentes con algún mes parcial o sin
 * datos y cuáles meses. «En curso» y «no aplica» no son huecos. `null` sin fuentes.
 */
export function summarizeCoverage(months: readonly string[], rows: readonly CoverageRow[]): string | null {
  if (rows.length === 0) return null
  const monthText = (month: string) => `${(MONTH_LABELS[Number(month.slice(5, 7)) - 1] ?? month).toLowerCase()} ${month.slice(0, 4)}`
  const gaps = rows.flatMap((row) => {
    const missing = months.filter((_, index) => row.cells[index]?.status === "missing" || row.cells[index]?.status === "partial")
    if (missing.length === 0) return []
    const shown = missing.slice(0, 3).map(monthText)
    const rest = missing.length - shown.length
    const list = rest > 0 ? `${shown.join(", ")} y ${rest} más` : shown.length > 1 ? `${shown.slice(0, -1).join(", ")} y ${shown[shown.length - 1]}` : shown[0]!
    return [`${row.label} (${list})`]
  })
  if (gaps.length === 0) return "Todas las fuentes tienen datos completos en los últimos meses cerrados."
  const names = gaps.length > 1 ? `${gaps.slice(0, -1).join(", ")} y ${gaps[gaps.length - 1]}` : gaps[0]!
  return `Hay huecos en ${gaps.length} de ${rows.length} ${rows.length === 1 ? "fuente" : "fuentes"}: ${names}.`
}
