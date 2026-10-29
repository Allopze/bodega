import { daysBetween } from "@/lib/mantencion/readings"

/**
 * Período y faena del panel (§10), tal como viajan en la URL. Módulo puro:
 * lo importan la página, la barra de filtros (cliente) y el Excel.
 */

export const PANEL_PERIODS = ["7", "30", "mes", "todo"] as const
export type PanelPeriod = (typeof PANEL_PERIODS)[number]

export const PANEL_PERIOD_LABEL: Record<PanelPeriod, string> = {
  "7": "7 días",
  "30": "30 días",
  mes: "Este mes",
  todo: "Todo",
}

/** Cómo se dice en una frase: «Registros · últimos 7 días». */
export const PANEL_PERIOD_PHRASE: Record<PanelPeriod, string> = {
  "7": "últimos 7 días",
  "30": "últimos 30 días",
  mes: "este mes",
  todo: "todo el historial",
}

export const DEFAULT_PANEL_PERIOD: PanelPeriod = "30"

export interface PanelFilters {
  period: PanelPeriod
  worksiteId?: string
}

export function parsePanelFilters(raw: Record<string, string | string[] | undefined>): PanelFilters {
  const pick = (key: string) => {
    const value = raw[key]
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? ""
  }
  const period = (PANEL_PERIODS as readonly string[]).includes(pick("periodo")) ? (pick("periodo") as PanelPeriod) : DEFAULT_PANEL_PERIOD
  const worksiteId = pick("faena")
  return { period, ...(worksiteId && worksiteId.length <= 64 ? { worksiteId } : {}) }
}

export function addDays(date: string, days: number): string {
  const [year = 1970, month = 1, day = 1] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

/** Primer día incluido en el período (`null` = sin límite). «7 días» incluye hoy: hoy y los 6 anteriores. */
export function periodStart(period: PanelPeriod, today: string): string | null {
  switch (period) {
    case "7": return addDays(today, -6)
    case "30": return addDays(today, -29)
    case "mes": return `${today.slice(0, 7)}-01`
    default: return null
  }
}

/** Lunes de la semana de una fecha (las semanas del gráfico empiezan en lunes). */
export function weekStart(date: string): string {
  const [year = 1970, month = 1, day = 1] = date.split("-").map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return addDays(date, -((weekday + 6) % 7))
}

/** Las últimas `count` semanas, de la más antigua a la actual, como lunes `YYYY-MM-DD`. */
export function lastWeeks(today: string, count: number): string[] {
  const current = weekStart(today)
  return Array.from({ length: count }, (_, index) => addDays(current, -7 * (count - 1 - index)))
}

/**
 * Días de un tramo detenido que caen dentro del período: ingreso → salida (o
 * hoy si sigue), recortado a [inicio del período, hoy]. Mismo criterio de
 * «ingreso → salida» de la regla 11, aplicado sólo a la parte del tramo que
 * pertenece al período: un equipo en taller desde hace 40 días no suma 40 a
 * «últimos 7 días».
 */
export function stoppedDaysWithin(entry: string, exit: string | null, today: string, from: string | null): number {
  const start = from && from > entry ? from : entry
  const end = exit && exit < today ? exit : today
  return Math.max(0, daysBetween(start, end))
}

/** Rótulo corto de una semana del gráfico: «26-10» (el lunes en que empieza). */
export function weekLabel(start: string): string {
  const [, month = "", day = ""] = start.split("-")
  return `${day}-${month}`
}

/** «26-10 al 01-11»: la semana completa, para la tabla «Ver datos» y los lectores de pantalla. */
export function weekRangeLabel(start: string): string {
  return `${weekLabel(start)} al ${weekLabel(addDays(start, 6))}`
}
