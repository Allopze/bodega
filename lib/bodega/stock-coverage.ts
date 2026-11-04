/**
 * Cobertura de stock en días (CHART-035a de `AUDITORIA_VISUALIZACIONES_CHOME.md`).
 *
 * Con los mínimos manuales retirados (2026-10-02) nada decía qué reponer. La
 * cobertura responde con lo que sí se mide: **cuántos días alcanza el saldo al
 * ritmo al que salió en los últimos 90 días**.
 *
 *   días = saldo / (consumo del período / días del período)
 *
 * Módulo **puro** y sin `server-only`: lo leen la consulta, la página, la tabla
 * (cliente) y las pruebas. La consulta que suma el consumo vive en
 * `lib/services/stock-coverage.ts`.
 *
 * Decisiones, todas de la auditoría o de sus riesgos de interpretación:
 *
 * - **Consumo** = entregas (`egreso_entrega`) y bajas (`egreso_desecho`). La
 *   salida por guía (`egreso_traslado`) no es consumo final: el producto sigue
 *   existiendo en otra faena. El reverso de una entrega anulada resta.
 * - **Sin consumo** nunca es infinito: es su propia banda.
 * - **Pocas salidas o poca historia** (demanda irregular de EPP, producto nuevo)
 *   no dan una cifra: «datos insuficientes», con el n a la vista. Una cobertura
 *   de «12 días» calculada con dos entregas es una cifra con aire de certeza que
 *   no la tiene.
 * - **Variantes de talla**: cada talla es un producto con su propio saldo y se
 *   evalúa sola. Sumarlas escondería la talla que se acabó detrás de la que
 *   sobra, y no se puede entregar una talla por otra.
 */
import { countOf } from "@/lib/utils"

/** Ventana del consumo, en días. */
export const COVERAGE_WINDOW_DAYS = 90
/** Salidas mínimas en la ventana para afirmar un ritmo. */
export const COVERAGE_MIN_EVENTS = 3
/** Días mínimos que el producto lleva en la faena para afirmar un ritmo. */
export const COVERAGE_MIN_HISTORY_DAYS = 30
/** Bajo este valor (días) el saldo es crítico. */
export const COVERAGE_CRITICAL_DAYS = 7
/** Sobre este valor (días) el saldo es holgado. */
export const COVERAGE_COMFORTABLE_DAYS = 30
/** La barra de la celda se llena a esta cantidad de días. */
export const COVERAGE_BAR_FULL_DAYS = 60
const COVERAGE_DISPLAY_CAP_DAYS = 365

/**
 * `lt7` menos de 7 días · `d7_30` de 7 a 30 · `gt30` más de 30 ·
 * `insufficient` hay consumo, pero no alcanza para afirmar un ritmo ·
 * `none` no hubo ninguna salida.
 */
export type CoverageBand = "lt7" | "d7_30" | "gt30" | "insufficient" | "none"

/** Orden del dominio (de lo más urgente a lo que no informa): el de la tira y la leyenda. */
export const COVERAGE_BAND_ORDER: readonly CoverageBand[] = ["lt7", "d7_30", "gt30", "insufficient", "none"]

export interface CoverageInput {
  /** Saldo físico actual. */
  quantity: number
  /** Consumo neto de la ventana (entregas + bajas − reversos). */
  consumed: number
  /** Salidas (entregas y bajas con efecto) dentro de la ventana. */
  events: number
  /** Días desde el primer movimiento de este producto en la faena; `null` si no tiene ninguno. */
  historyDays: number | null
}

export interface StockCoverage {
  band: CoverageBand
  /** Días que alcanza el saldo; `null` fuera de las bandas medibles. */
  days: number | null
  /** Consumo diario con el que se calculó; `null` fuera de las bandas medibles. */
  dailyRate: number | null
  /** Salidas en la ventana: el n que respalda (o no) la cifra. */
  events: number
  /** Días sobre los que se midió el ritmo (hasta 90); `null` si no se midió. */
  windowDays: number | null
}

const finiteOrZero = (value: number) => (Number.isFinite(value) ? value : 0)

export function computeCoverage(input: CoverageInput): StockCoverage {
  const consumed = Math.max(0, finiteOrZero(input.consumed))
  const events = Math.max(0, Math.floor(finiteOrZero(input.events)))
  if (consumed <= 0 || events === 0) return { band: "none", days: null, dailyRate: null, events, windowDays: null }

  const quantity = Number.isFinite(input.quantity) ? Math.max(0, input.quantity) : null
  const history = input.historyDays
  if (quantity === null || events < COVERAGE_MIN_EVENTS || history === null || history < COVERAGE_MIN_HISTORY_DAYS) {
    return { band: "insufficient", days: null, dailyRate: null, events, windowDays: null }
  }

  // Un producto que lleva 40 días en la faena se mide sobre 40, no sobre 90: dividir
  // por 90 un consumo de 40 días subestimaría el ritmo y prometería más cobertura.
  const windowDays = Math.min(COVERAGE_WINDOW_DAYS, Math.floor(history))
  const dailyRate = consumed / windowDays
  const days = quantity / dailyRate
  // La banda se decide sobre el valor que se muestra (piso): 30,5 días se ve «30 d»
  // y no puede estar en «más de 30».
  const shown = Math.floor(days)
  const band: CoverageBand = shown < COVERAGE_CRITICAL_DAYS ? "lt7" : shown <= COVERAGE_COMFORTABLE_DAYS ? "d7_30" : "gt30"
  return { band, days, dailyRate, events, windowDays }
}

/** «12 d». Hacia abajo: prometer de menos es el error barato; «6,9» no puede leerse «7». */
export function formatCoverageDays(days: number): string {
  if (!Number.isFinite(days) || days < 0) return "—"
  if (days > COVERAGE_DISPLAY_CAP_DAYS) return `más de ${COVERAGE_DISPLAY_CAP_DAYS} d`
  if (days > 0 && days < 1) return "menos de 1 d"
  return `${Math.floor(days)} d`
}

/** Largo de la barra de la celda, de 0 a 1: se llena a los 60 días. */
export function coverageBarFraction(days: number): number {
  if (!Number.isFinite(days) || days <= 0) return 0
  return Math.min(1, days / COVERAGE_BAR_FULL_DAYS)
}

export interface CoverageBandMeta {
  /** Rótulo corto de la leyenda y de la celda. */
  label: string
  /** Qué significa, para el tooltip y la alternativa en datos. */
  definition: string
  /** Relleno (un `var(--color-*)`, nunca un hex). */
  color: string
  /** Clase del texto de la celda: siempre la variante `-ink` (regla 8). */
  textClass: string
}

export const COVERAGE_BANDS: Record<CoverageBand, CoverageBandMeta> = {
  lt7: {
    label: "Menos de 7 días",
    definition: "Al ritmo de los últimos 90 días, el saldo se agota en menos de 7 días.",
    color: "var(--color-danger)",
    textClass: "text-[var(--color-danger-ink)]",
  },
  d7_30: {
    label: "7 a 30 días",
    definition: "Al ritmo de los últimos 90 días, el saldo alcanza entre 7 y 30 días.",
    color: "var(--color-warning)",
    textClass: "text-[var(--color-warning-ink)]",
  },
  gt30: {
    label: "Más de 30 días",
    definition: "Al ritmo de los últimos 90 días, el saldo alcanza más de 30 días.",
    color: "var(--color-success)",
    textClass: "text-[var(--color-success-ink)]",
  },
  insufficient: {
    label: "Datos insuficientes",
    definition: `Hubo salidas, pero menos de ${COVERAGE_MIN_EVENTS} en 90 días o el producto lleva menos de ${COVERAGE_MIN_HISTORY_DAYS} días en la faena: no alcanza para afirmar un ritmo.`,
    color: "var(--color-info)",
    textClass: "text-[var(--color-info-ink)]",
  },
  none: {
    label: "Sin consumo",
    definition: "No salió ninguna unidad por entrega o baja en los últimos 90 días.",
    color: "var(--color-chart-reference)",
    textClass: "text-[var(--color-text-muted)]",
  },
}

export const coverageBandLabel = (band: CoverageBand): string => COVERAGE_BANDS[band].label
export const coverageBandColor = (band: CoverageBand): string => COVERAGE_BANDS[band].color

/** Texto de la celda: «12 d», «Sin consumo» o «Datos insuficientes». */
export function coverageCellLabel(coverage: StockCoverage): string {
  if (coverage.band === "none") return "Sin consumo"
  if (coverage.band === "insufficient") return "Datos insuficientes"
  return formatCoverageDays(coverage.days ?? 0)
}

/** Explica la cifra con su n, para el `title` de la celda: «3 salidas en 90 días · 1,2 u/día». */
export function coverageCellDetail(coverage: StockCoverage): string {
  if (coverage.band === "none") return COVERAGE_BANDS.none.definition
  if (coverage.band === "insufficient") {
    return `${countOf(coverage.events, "salida", "salidas")} en los últimos 90 días: ${COVERAGE_BANDS.insufficient.definition}`
  }
  const rate = coverage.dailyRate ?? 0
  const perDay = rate >= 10 ? Math.round(rate).toLocaleString("es-CL") : rate.toLocaleString("es-CL", { maximumFractionDigits: 1 })
  return `${countOf(coverage.events, "salida", "salidas")} en ${coverage.windowDays} días · ${perDay} por día`
}

/** `?cobertura=` es entrada del usuario: sólo pasan las claves de banda. */
export function parseCoverageParam(value: string | string[] | undefined): CoverageBand | "" {
  const raw = Array.isArray(value) ? value[0] : value
  return COVERAGE_BAND_ORDER.find((band) => band === raw) ?? ""
}

export interface CoverageSummary {
  total: number
  /** Con una cifra de días (las tres primeras bandas). */
  measured: number
  byBand: Record<CoverageBand, number>
}

export function summarizeCoverage(bands: readonly CoverageBand[]): CoverageSummary {
  const byBand: Record<CoverageBand, number> = { lt7: 0, d7_30: 0, gt30: 0, insufficient: 0, none: 0 }
  for (const band of bands) byBand[band] += 1
  return { total: bands.length, measured: byBand.lt7 + byBand.d7_30 + byBand.gt30, byBand }
}

export type CoverageNoun = string | { singular: string; plural: string }

const nounParts = (noun: CoverageNoun) => (typeof noun === "string" ? { singular: noun, plural: `${noun}s` } : noun)

/**
 * La respuesta del gráfico, antes del dibujo. Verdadera también en los estados
 * parciales: «ninguno» sólo se dice de lo que se pudo medir, y lo que no se pudo
 * medir se cuenta aparte en vez de esconderse dentro de «ninguno».
 */
export function coverageSummary(summary: CoverageSummary, noun: CoverageNoun): string | null {
  if (summary.total === 0) return null
  const { singular, plural } = nounParts(noun)
  const { lt7, insufficient, none } = summary.byBand
  const rest = [
    insufficient > 0 ? `${insufficient.toLocaleString("es-CL")} con datos insuficientes` : null,
    none > 0 ? `${none.toLocaleString("es-CL")} sin consumo` : null,
  ].filter((part): part is string => part !== null)
  const tail = rest.length > 0 ? ` ${rest.join(" y ")}.` : ""
  const basis = "Con el consumo de los últimos 90 días"

  if (summary.measured === 0) {
    return `Todavía no hay consumo suficiente para estimar cuántos días alcanza el stock.${tail}`
  }
  if (lt7 > 0) {
    const head = summary.total === 1
      ? `${basis}, el único ${singular} alcanza para menos de 7 días.`
      : `${basis}, ${lt7.toLocaleString("es-CL")} de ${summary.total.toLocaleString("es-CL")} ${plural} ${lt7 === 1 ? "alcanza" : "alcanzan"} para menos de 7 días.`
    return `${head}${tail}`
  }
  const allMeasured = summary.measured === summary.total
  if (summary.measured === 1) {
    return `${basis}, el único ${singular}${allMeasured ? "" : " con consumo medido"} alcanza para 7 días o más.${tail}`
  }
  const scope = allMeasured
    ? `los ${summary.total.toLocaleString("es-CL")} ${plural}`
    : `los ${summary.measured.toLocaleString("es-CL")} ${plural} con consumo medido`
  return `Ninguno de ${scope} alcanza para menos de 7 días, según el consumo de los últimos 90 días.${tail}`
}
