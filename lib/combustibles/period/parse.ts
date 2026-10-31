import { addDaysToPlainDate, MONTH_LABELS, MONTH_NAMES, todayInChile } from "@/lib/utils"
import type { FuelPeriod, FuelPeriodSource, ResolvedFuelPeriod } from "./types"

/**
 * Lectura, escritura y cálculo del período de Combustible. Módulo puro: lo usan
 * Server Components, Client Components y pruebas por igual, así que no importa
 * nada server-only.
 */

const MONTH_TOKEN = /^(\d{4})-(0[1-9]|1[0-2])$/
const QUARTER_TOKEN = /^(\d{4})-T([1-4])$/
const YEAR_TOKEN = /^(\d{4})$/
const WEEK_TOKEN = /^(\d{4})-S(\d{2})$/
const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/
const COOKIE_RANGE = /^r:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/

/** Un rango más largo no tiene sentido en las vistas del módulo y dispara consultas caras. */
const MAX_RANGE_DAYS = 731
const MIN_YEAR = 2000
const MAX_YEAR = 2100

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>

function param(sp: ParamSource, key: string): string | undefined {
  const raw = sp instanceof URLSearchParams ? sp.get(key) ?? undefined : sp[key]
  const value = Array.isArray(raw) ? raw[0] : raw
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

function isValidPlainDate(value: string | undefined): value is string {
  if (!value || !PLAIN_DATE.test(value)) return false
  const [y, m, d] = value.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

function validYear(year: number): boolean {
  return Number.isInteger(year) && year >= MIN_YEAR && year <= MAX_YEAR
}

function lastDayOfMonth(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${year}-${pad(month)}-${pad(day)}`
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/* ---------- Semanas ISO (lunes a domingo) ---------- */

function mondayOfIsoWeek(year: number, week: number): string {
  const jan4 = Date.UTC(year, 0, 4)
  const jan4Weekday = (new Date(jan4).getUTCDay() + 6) % 7 // lunes = 0
  const monday = jan4 - jan4Weekday * 86_400_000 + (week - 1) * 7 * 86_400_000
  return new Date(monday).toISOString().slice(0, 10)
}

export function isoWeeksInYear(year: number): number {
  // Un año tiene 53 semanas ISO si el 28 de diciembre cae en la semana 53.
  return isoWeekOf(`${year}-12-28`).week
}

export function isoWeekOf(plainDate: string): { year: number; week: number } {
  const time = Date.parse(`${plainDate}T00:00:00Z`)
  const weekday = (new Date(time).getUTCDay() + 6) % 7
  const thursday = new Date(time + (3 - weekday) * 86_400_000)
  const year = thursday.getUTCFullYear()
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * 86_400_000)) + 1
  return { year, week }
}

/* ---------- Tokens ---------- */

export function parseFuelPeriodToken(token: string | undefined | null): FuelPeriod | null {
  if (!token) return null
  const value = token.trim()
  let match = MONTH_TOKEN.exec(value)
  if (match) {
    const year = Number(match[1])
    return validYear(year) ? { kind: "month", year, month: Number(match[2]) } : null
  }
  match = QUARTER_TOKEN.exec(value)
  if (match) {
    const year = Number(match[1])
    return validYear(year) ? { kind: "quarter", year, quarter: Number(match[2]) } : null
  }
  match = WEEK_TOKEN.exec(value)
  if (match) {
    const year = Number(match[1])
    const week = Number(match[2])
    return validYear(year) && week >= 1 && week <= isoWeeksInYear(year) ? { kind: "week", year, week } : null
  }
  match = YEAR_TOKEN.exec(value)
  if (match) {
    const year = Number(match[1])
    return validYear(year) ? { kind: "year", year } : null
  }
  return null
}

/** `null` para un rango: viaja en `desde`/`hasta`. */
export function formatFuelPeriodToken(period: FuelPeriod): string | null {
  switch (period.kind) {
    case "week": return `${period.year}-S${pad(period.week)}`
    case "month": return `${period.year}-${pad(period.month)}`
    case "quarter": return `${period.year}-T${period.quarter}`
    case "year": return String(period.year)
    case "range": return null
  }
}

/** Valor de la cookie: el token, o `r:<desde>:<hasta>` para un rango. */
export function formatFuelPeriodCookie(period: FuelPeriod): string {
  return period.kind === "range" ? `r:${period.from}:${period.to}` : String(formatFuelPeriodToken(period))
}

export function parseFuelPeriodCookie(value: string | undefined | null): FuelPeriod | null {
  if (!value) return null
  const range = COOKIE_RANGE.exec(value)
  if (range) return normalizeRange(range[1], range[2])
  return parseFuelPeriodToken(value)
}

/** Parámetros de URL que representan el período (para armar enlaces). */
export function fuelPeriodSearchParams(period: FuelPeriod): Record<string, string> {
  if (period.kind === "range") return { desde: period.from, hasta: period.to }
  return { periodo: String(formatFuelPeriodToken(period)) }
}

/* ---------- Límites ---------- */

function normalizeRange(from: string, to: string): FuelPeriod | null {
  if (!isValidPlainDate(from) || !isValidPlainDate(to)) return null
  const [earliest, end] = from <= to ? [from, to] : [to, from]
  const start = daysBetween(earliest, end) > MAX_RANGE_DAYS ? addDaysToPlainDate(end, -MAX_RANGE_DAYS) : earliest
  return { kind: "range", from: start, to: end }
}

export function fuelPeriodBounds(period: FuelPeriod): { from: string; to: string } {
  switch (period.kind) {
    case "week": {
      const from = mondayOfIsoWeek(period.year, period.week)
      return { from, to: addDaysToPlainDate(from, 6) }
    }
    case "month":
      return { from: `${period.year}-${pad(period.month)}-01`, to: lastDayOfMonth(period.year, period.month) }
    case "quarter": {
      const first = period.quarter * 3 - 2
      return { from: `${period.year}-${pad(first)}-01`, to: lastDayOfMonth(period.year, first + 2) }
    }
    case "year":
      return { from: `${period.year}-01-01`, to: `${period.year}-12-31` }
    case "range":
      return { from: period.from, to: period.to }
  }
}

export function monthKeysBetween(from: string, to: string): string[] {
  const keys: string[] = []
  let year = Number(from.slice(0, 4))
  let month = Number(from.slice(5, 7))
  const endKey = to.slice(0, 7)
  for (let guard = 0; guard < 60; guard++) {
    const key = `${year}-${pad(month)}`
    keys.push(key)
    if (key >= endKey) break
    month += 1
    if (month > 12) { month = 1; year += 1 }
  }
  return keys
}

/** El período anterior (`direction=-1`) o siguiente (`+1`) del mismo tipo y largo. */
export function shiftFuelPeriod(period: FuelPeriod, direction: -1 | 1): FuelPeriod {
  switch (period.kind) {
    case "week": {
      const { from } = fuelPeriodBounds(period)
      const { year, week } = isoWeekOf(addDaysToPlainDate(from, direction * 7))
      return { kind: "week", year, week }
    }
    case "month": {
      const index = period.year * 12 + (period.month - 1) + direction
      return { kind: "month", year: Math.floor(index / 12), month: (index % 12) + 1 }
    }
    case "quarter": {
      const index = period.year * 4 + (period.quarter - 1) + direction
      return { kind: "quarter", year: Math.floor(index / 4), quarter: (index % 4) + 1 }
    }
    case "year":
      return { kind: "year", year: period.year + direction }
    case "range": {
      const length = daysBetween(period.from, period.to) + 1
      return direction < 0
        ? { kind: "range", from: addDaysToPlainDate(period.from, -length), to: addDaysToPlainDate(period.from, -1) }
        : { kind: "range", from: addDaysToPlainDate(period.to, 1), to: addDaysToPlainDate(period.to, length) }
    }
  }
}

/** Los `count` períodos que terminan en `period` (incluido), del más antiguo al más reciente. */
export function previousFuelPeriods(period: FuelPeriod, count: number): FuelPeriod[] {
  const out: FuelPeriod[] = [period]
  while (out.length < count) out.unshift(shiftFuelPeriod(out[0], -1))
  return out
}

/* ---------- Rótulos ---------- */

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const ordinal = (q: number) => (q === 1 || q === 3 ? `${q}.er` : `${q}.º`)

function shortDate(plainDate: string, withYear: boolean): string {
  const [y, m, d] = plainDate.split("-").map(Number)
  return `${d} ${MONTH_LABELS[m - 1].toLowerCase()}${withYear ? ` ${y}` : ""}`
}

function longDate(plainDate: string, withYear: boolean): string {
  const [y, m, d] = plainDate.split("-").map(Number)
  return `${d} de ${MONTH_NAMES[m - 1]}${withYear ? ` de ${y}` : ""}`
}

export function fuelPeriodLabels(period: FuelPeriod, today = todayInChile()): { label: string; inLabel: string } {
  const currentYear = Number(today.slice(0, 4))
  switch (period.kind) {
    case "week": {
      const { from } = fuelPeriodBounds(period)
      const otherYear = Number(from.slice(0, 4)) !== currentYear
      return { label: `Semana del ${shortDate(from, otherYear)}`, inLabel: `la semana del ${longDate(from, otherYear)}` }
    }
    case "month": {
      const name = MONTH_NAMES[period.month - 1]
      return { label: `${capitalize(name)} ${period.year}`, inLabel: period.year === currentYear ? name : `${name} de ${period.year}` }
    }
    case "quarter":
      return {
        label: `${ordinal(period.quarter)} trimestre ${period.year}`,
        inLabel: `el ${ordinal(period.quarter)} trimestre${period.year === currentYear ? "" : ` de ${period.year}`}`,
      }
    case "year":
      return { label: `Año ${period.year}`, inLabel: String(period.year) }
    case "range": {
      const otherYear = Number(period.from.slice(0, 4)) !== currentYear || period.from.slice(0, 4) !== period.to.slice(0, 4)
      return {
        label: `${shortDate(period.from, otherYear)} – ${shortDate(period.to, otherYear)}`,
        inLabel: `el período del ${longDate(period.from, otherYear)} al ${longDate(period.to, otherYear)}`,
      }
    }
  }
}

/* ---------- Resolución ---------- */

export function describeFuelPeriod(period: FuelPeriod, source: FuelPeriodSource, today = todayInChile()): ResolvedFuelPeriod {
  const { from, to } = fuelPeriodBounds(period)
  const status = to < today ? "cerrado" : from > today ? "futuro" : "en_curso"
  const following = shiftFuelPeriod(period, 1)
  const { label, inLabel } = fuelPeriodLabels(period, today)
  return {
    period,
    token: formatFuelPeriodToken(period),
    from,
    to,
    monthKeys: monthKeysBetween(from, to),
    label,
    inLabel,
    status,
    dueDate: to,
    isWholeMonths: period.kind === "month" || period.kind === "quarter" || period.kind === "year",
    prev: shiftFuelPeriod(period, -1),
    next: fuelPeriodBounds(following).from > today ? null : following,
    source,
  }
}

/** Convierte los filtros de fecha que usaban las pantallas antes del rediseño. */
export function legacyFuelPeriodFromParams(sp: ParamSource): FuelPeriod | null {
  const rangeFrom = param(sp, "from") ?? param(sp, "startDate")
  const rangeTo = param(sp, "to") ?? param(sp, "endDate")
  if (rangeFrom || rangeTo) {
    const from = rangeFrom ?? (rangeTo ? `${rangeTo.slice(0, 7)}-01` : undefined)
    const to = rangeTo ?? todayInChile()
    if (from) {
      const range = normalizeRange(from, to)
      if (range) return range
    }
  }
  const month = param(sp, "month")
  if (month) {
    const parsed = parseFuelPeriodToken(month)
    if (parsed?.kind === "month") return parsed
  }
  const yearParam = param(sp, "anio")
  if (yearParam && YEAR_TOKEN.test(yearParam) && validYear(Number(yearParam))) {
    const year = Number(yearParam)
    const months = (param(sp, "meses") ?? "")
      .split(",").map((m) => Number(m.trim())).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12)
      .sort((a, b) => a - b)
    const unique = [...new Set(months)]
    if (unique.length === 0) return { kind: "year", year }
    if (unique.length === 1) return { kind: "month", year, month: unique[0] }
    const contiguous = unique.every((m, i) => i === 0 || m === unique[i - 1] + 1)
    if (unique.length === 3 && contiguous && unique[0] % 3 === 1) return { kind: "quarter", year, quarter: (unique[0] + 2) / 3 }
    // Meses no correlativos: el rango que los cubre es la mejor aproximación.
    return { kind: "range", from: `${year}-${pad(unique[0])}-01`, to: lastDayOfMonth(year, unique[unique.length - 1]) }
  }
  return null
}

export interface ResolveFuelPeriodInput {
  searchParams: ParamSource
  cookieValue?: string | null
  fallback: FuelPeriod
  today?: string
}

/**
 * Precedencia: `periodo` → `desde`/`hasta` → filtros antiguos → cookie → valor
 * por rol. Un valor inválido se ignora y cae al siguiente.
 */
export function resolveFuelPeriod({ searchParams, cookieValue, fallback, today = todayInChile() }: ResolveFuelPeriodInput): ResolvedFuelPeriod {
  const fromToken = parseFuelPeriodToken(param(searchParams, "periodo"))
  if (fromToken) return describeFuelPeriod(fromToken, "url", today)
  const desde = param(searchParams, "desde")
  const hasta = param(searchParams, "hasta")
  if (desde || hasta) {
    const range = normalizeRange(desde ?? `${(hasta ?? today).slice(0, 7)}-01`, hasta ?? today)
    if (range) return describeFuelPeriod(range, "url", today)
  }
  const legacy = legacyFuelPeriodFromParams(searchParams)
  if (legacy) return describeFuelPeriod(legacy, "legacy", today)
  const fromCookie = parseFuelPeriodCookie(cookieValue)
  if (fromCookie) return describeFuelPeriod(fromCookie, "cookie", today)
  return describeFuelPeriod(fallback, "default", today)
}

export function currentMonthPeriod(today = todayInChile()): Extract<FuelPeriod, { kind: "month" }> {
  return { kind: "month", year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }
}

export function currentWeekPeriod(today = todayInChile()): FuelPeriod {
  const { year, week } = isoWeekOf(today)
  return { kind: "week", year, week }
}

export interface FuelPeriodPreset {
  key: "semana" | "mes" | "mes-anterior" | "trimestre" | "trimestre-anterior" | "anio"
  label: string
  period: FuelPeriod
}

export function fuelPeriodPresets(today = todayInChile()): FuelPeriodPreset[] {
  const month = currentMonthPeriod(today)
  const quarter: FuelPeriod = { kind: "quarter", year: month.year, quarter: Math.ceil(month.month / 3) }
  return [
    { key: "semana", label: "Esta semana", period: currentWeekPeriod(today) },
    { key: "mes", label: "Este mes", period: month },
    { key: "mes-anterior", label: "Mes anterior", period: shiftFuelPeriod(month, -1) },
    { key: "trimestre", label: "Este trimestre", period: quarter },
    { key: "trimestre-anterior", label: "Trimestre anterior", period: shiftFuelPeriod(quarter, -1) },
    { key: "anio", label: "Este año", period: { kind: "year", year: month.year } },
  ]
}

export function sameFuelPeriod(a: FuelPeriod, b: FuelPeriod): boolean {
  return formatFuelPeriodCookie(a) === formatFuelPeriodCookie(b)
}
