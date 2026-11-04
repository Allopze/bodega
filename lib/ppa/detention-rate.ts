/**
 * lib/ppa/detention-rate.ts
 *
 * La tasa de detención del PPA (CHART-011 de `AUDITORIA_VISUALIZACIONES_CHOME.md`):
 * qué proporción de los PPA llenados terminó en «detenido», por mes y por faena.
 *
 * **Nunca un porcentaje pelado.** En producción hay once PPA: «27 %» sobre once
 * es tres casos, y un ranking de faenas con tasas de 0 % y 100 % sobre uno o dos
 * PPA castiga o premia al azar. Por eso:
 *
 * - toda tasa viaja con su base (`n`) y con el conteo de detenidos;
 * - bajo `PPA_RATE_MIN_SAMPLE` PPA no hay porcentaje: se dice el conteo honesto
 *   («3 de 11 PPA detenidos») y que la base es demasiado chica (n = 11). La línea
 *   del gráfico se corta en ese mes (no baja a cero);
 * - el ranking de faenas es por TASA, no por conteo absoluto: ordenar por
 *   detenidos castiga a la faena que más PPA llena (es la que mejor usa la
 *   herramienta).
 *
 * Lógica pura, sin base de datos ni React.
 */

import { formatPercent } from "@/lib/utils"
import { addMonths, fillMonthSeries, monthPeriodLabel, monthPeriodName, monthRangeText } from "@/lib/prevention/monthly-series"

/**
 * Cuántos PPA hacen falta para calcular una tasa. Con menos de veinte, un solo caso
 * mueve la tasa más de cinco puntos y el intervalo de una proporción abarca decenas
 * de puntos: «27 %» sobre once PPA (que son los que hay hoy en producción) son tres
 * casos y no una tendencia. Es una decisión de lectura, no de negocio; un solo lugar
 * donde cambiarla.
 */
export const PPA_RATE_MIN_SAMPLE = 20

export type DetentionRate =
  | { sufficient: true; percent: number; n: number; detained: number }
  | { sufficient: false; n: number; detained: number }

/** Un decimal alcanza: 27,3 % y 27,27 % no cambian ninguna decisión. */
function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}

export function detentionRate(detained: number, total: number, minSample = PPA_RATE_MIN_SAMPLE): DetentionRate {
  if (total < minSample || total <= 0) return { sufficient: false, n: total, detained }
  return { sufficient: true, percent: oneDecimal((detained / total) * 100), n: total, detained }
}

/** «3 de 12 PPA detenidos». */
export function detentionBasis(rate: DetentionRate): string {
  return `${rate.detained} de ${rate.n} PPA ${rate.detained === 1 ? "detenido" : "detenidos"}`
}

/**
 * «Base demasiado chica para un porcentaje (n = 11)». La nota que acompaña al conteo
 * cuando no hay tasa: dice que la base no alcanza y de cuántos PPA se habla.
 */
export function insufficientNote(n: number): string {
  return `Base demasiado chica para un porcentaje (n = ${n})`
}

/** La celda de «Tasa» de una tabla de datos cuando no hay porcentaje: «Sin porcentaje: base chica (n = 4)». */
export function insufficientCell(n: number): string {
  return `Sin porcentaje: base chica (n = ${n})`
}

/**
 * La cifra de la tasa de detención para una tira de indicadores o un tile del tablero:
 * una sola regla para todo lugar donde aparezca la misma magnitud.
 *
 * - con base suficiente: el porcentaje (`27,3%`) y su base («6 de 22 PPA detenidos»);
 * - bajo el mínimo: el conteo («3 de 11») como cifra, la base completa y la nota de
 *   que no alcanza para un porcentaje. Nunca un `%`;
 * - sin PPA: no hay cifra (el llamador dice qué falta para dejar de estar vacío).
 */
export type DetentionFigure =
  | { kind: "empty" }
  | { kind: "rate"; value: string; percent: number; basis: string }
  | { kind: "count"; value: string; basis: string; note: string }

export function detentionFigure(detained: number, total: number, minSample = PPA_RATE_MIN_SAMPLE): DetentionFigure {
  if (total <= 0) return { kind: "empty" }
  const rate = detentionRate(detained, total, minSample)
  if (rate.sufficient) {
    return { kind: "rate", value: formatPercent(rate.percent, 1), percent: rate.percent, basis: detentionBasis(rate) }
  }
  return { kind: "count", value: `${detained} de ${total}`, basis: detentionBasis(rate), note: insufficientNote(total) }
}

/* ── Serie mensual ──────────────────────────────────────────────────────── */

export interface PpaMonthRow {
  month: string
  total: number
  detained: number
}

export interface PpaMonthPoint {
  month: string
  total: number
  detained: number
  rate: DetentionRate
  /** El mes en curso, que todavía no termina. */
  partial: boolean
}

export function shapePpaMonthly(rows: readonly PpaMonthRow[], today: string, minSample = PPA_RATE_MIN_SAMPLE): PpaMonthPoint[] {
  return fillMonthSeries<PpaMonthRow>(rows, {
    today,
    empty: (month) => ({ month, total: 0, detained: 0 }),
  }).map((row) => ({
    month: row.month,
    total: row.total,
    detained: row.detained,
    rate: detentionRate(row.detained, row.total, minSample),
    partial: row.partial,
  }))
}

/** Nota del tooltip de un mes: la base de la tasa o, bajo el mínimo, el conteo y por qué no hay porcentaje. */
export function ppaMonthNote(point: PpaMonthPoint): string {
  if (point.total === 0) return "Sin PPA en el mes"
  return point.rate.sufficient ? detentionBasis(point.rate) : `${detentionBasis(point.rate)}. ${insufficientNote(point.total)}`
}

/**
 * La frase que responde «¿qué proporción de los PPA termina detenida?».
 *
 * Sin PPA no dice nada (la lista de abajo ya explica el vacío). Bajo el mínimo no
 * da una tasa: da el conteo («3 de 11 PPA detenidos») y dice que la base no alcanza. Con base suficiente da la
 * tasa de la ventana con su `n`, y sólo compara dos meses si ambos son completos,
 * contiguos y con base suficiente.
 */
export function summarizePpaTrend(points: readonly PpaMonthPoint[], minSample = PPA_RATE_MIN_SAMPLE): string {
  const withData = points.filter((point) => point.total > 0)
  if (withData.length === 0) return ""
  const total = withData.reduce((sum, point) => sum + point.total, 0)
  const detained = withData.reduce((sum, point) => sum + point.detained, 0)
  const range = monthRangeText(withData[0]!.month, withData[withData.length - 1]!.month)
  const overall = detentionRate(detained, total, minSample)

  if (!overall.sufficient) {
    return `${detentionBasis(overall)} ${range}. ${insufficientNote(total)}; se necesitan al menos ${minSample} para una tasa de detención.`
  }

  const base = `${detentionBasis(overall)} ${range}: tasa de detención de ${formatPercent(overall.percent, 1)}`
  const complete = points.filter((point) => !point.partial && point.rate.sufficient)
  const latest = complete[complete.length - 1]
  const previous = latest ? complete.find((point) => point.month === addMonths(latest.month, -1)) : undefined
  if (!latest || !previous || !latest.rate.sufficient || !previous.rate.sufficient) return `${base}.`

  const delta = oneDecimal(latest.rate.percent - previous.rate.percent)
  const abs = Math.abs(delta)
  const comparison = delta === 0
    ? `igual que en ${monthPeriodName(previous.month)}`
    : `${abs} ${abs === 1 ? "punto" : "puntos"} ${delta > 0 ? "sobre" : "bajo"} ${monthPeriodName(previous.month)}`
  return `${base}. En ${monthPeriodName(latest.month)} fue de ${formatPercent(latest.rate.percent, 1)} (${latest.rate.n} PPA), ${comparison}.`
}

export function ppaTrendDataTable(points: readonly PpaMonthPoint[]): { headers: string[]; rows: Array<Array<string | number>> } {
  return {
    headers: ["Mes", "PPA", "Detenidos", "Tasa de detención"],
    rows: points.map((point) => [
      point.partial ? `${monthPeriodLabel(point.month)} (en curso)` : monthPeriodLabel(point.month),
      point.total,
      point.detained,
      point.total === 0 ? "—" : point.rate.sufficient ? formatPercent(point.rate.percent, 1) : insufficientCell(point.total),
    ]),
  }
}

/* ── Ranking por faena ──────────────────────────────────────────────────── */

export interface PpaWorksiteRow {
  worksiteId: string
  worksiteName: string
  total: number
  detained: number
}

export interface PpaWorksiteRanking {
  /** Faenas con base suficiente, como filas de `RankedList` (valor = tasa en %). */
  items: Array<{ key: string; label: string; value: number; detail: string }>
  /**
   * Faenas sin base suficiente: no entran al ranking (sin porcentaje) pero se nombran
   * con su conteo honesto (`basis`: «1 de 3 PPA detenido»).
   */
  insufficient: Array<{ key: string; label: string; n: number; detained: number; basis: string }>
}

export function shapeWorksiteRanking(rows: readonly PpaWorksiteRow[], minSample = PPA_RATE_MIN_SAMPLE): PpaWorksiteRanking {
  const items: PpaWorksiteRanking["items"] = []
  const insufficient: PpaWorksiteRanking["insufficient"] = []
  for (const row of rows) {
    if (row.total <= 0) continue
    const rate = detentionRate(row.detained, row.total, minSample)
    if (rate.sufficient) {
      items.push({ key: row.worksiteId, label: row.worksiteName, value: rate.percent, detail: detentionBasis(rate) })
    } else {
      insufficient.push({ key: row.worksiteId, label: row.worksiteName, n: row.total, detained: row.detained, basis: detentionBasis(rate) })
    }
  }
  insufficient.sort((left, right) => right.n - left.n || left.label.localeCompare(right.label, "es-CL"))
  return { items, insufficient }
}
