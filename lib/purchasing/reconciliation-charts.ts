/**
 * Conciliación OC–factura y cobertura de DTE (CHART-034 de
 * `AUDITORIA_VISUALIZACIONES_CHOME.md`), para `/compras/dte`.
 *
 * Módulo **puro**: lo leen las consultas (`lib/services/purchasing-module/
 * reconciliation-overview.ts`), la página, los gráficos (cliente) y las pruebas.
 *
 * Reglas que no son obvias:
 *
 * - **Monto por facturar** = Σ max(0, total de la OC − facturado). Las notas de
 *   crédito restan (se guardan con monto negativo) y las facturas anuladas no
 *   cuentan. El tope en cero es por OC: una OC facturada de más no puede esconder
 *   lo que a otra todavía le falta.
 * - **El estado es una proyección** guardada en la OC (`invoice_reconciliation_
 *   status`); el monto, en cambio, se calcula en vivo. Por eso la pantalla los
 *   presenta como lo que son.
 * - **El mes en curso es parcial**: se marca, nunca se dibuja como una caída.
 * - **Una tasa muestra su n**, y con pocos documentos no hay porcentaje: «datos
 *   insuficientes», no una cifra con aire de certeza.
 * - **Colores**: los estados usan los semánticos; vecinos de la pila nunca
 *   comparten color, y `warning` y `signal` (los dos anaranjados) quedan
 *   separados por un gris para que no se confundan.
 */
import { MONTH_NAMES, formatCLP, formatPercent } from "@/lib/utils"

// ── Meses ────────────────────────────────────────────────────────────────────

/** Los últimos `count` meses «YYYY-MM» de `today` («YYYY-MM-DD», Chile), del más antiguo al mes en curso. */
export function reconciliationMonths(today: string, count = 12): string[] {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  return Array.from({ length: Math.max(1, count) }, (_, index) => {
    const offset = count - 1 - index
    const total = year * 12 + (month - 1) - offset
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`
  })
}

/** «octubre 2026». */
export function monthLabel(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? ""} ${month.slice(0, 4)}`
}

const windowText = (months: number): string => (months === 1 ? "este mes" : `los últimos ${months} meses`)
const rowLabel = (month: string, partial: boolean): string => `${monthLabel(month)}${partial ? " (en curso)" : ""}`
const cleanAmount = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0)
const cleanCount = (value: number): number => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0)

// ── Conciliación de las OC ───────────────────────────────────────────────────

export type ReconciliationStatus =
  | "needs_review"
  | "partially_invoiced"
  | "awaiting_receipt"
  | "no_invoices"
  | "accepted_exception"
  | "matched"

/**
 * Orden de la pila, de abajo hacia arriba. Lo que pide acción va en el piso del
 * gráfico —donde el largo se compara mejor— y lo resuelto arriba. `needs_review`
 * es `danger`; los dos anaranjados (`warning`, `signal`) no son vecinos.
 */
export const RECONCILIATION_STATUS_ORDER: readonly ReconciliationStatus[] = [
  "needs_review",
  "partially_invoiced",
  "awaiting_receipt",
  "no_invoices",
  "accepted_exception",
  "matched",
]

/** Mismas palabras que la ficha de la OC (`invoice-reconciliation-card.tsx`). */
export const RECONCILIATION_STATUS_META: Record<ReconciliationStatus, { label: string; color: string }> = {
  needs_review: { label: "Revisión requerida", color: "var(--color-danger)" },
  partially_invoiced: { label: "Facturación parcial", color: "var(--color-warning)" },
  awaiting_receipt: { label: "Recepción pendiente", color: "var(--color-chart-reference)" },
  no_invoices: { label: "Sin facturas", color: "var(--color-signal)" },
  accepted_exception: { label: "Diferencias aceptadas", color: "var(--color-info)" },
  matched: { label: "Conciliada", color: "var(--color-success)" },
}

export const reconciliationStatusColor = (status: ReconciliationStatus): string => RECONCILIATION_STATUS_META[status].color

const isStatus = (value: string): value is ReconciliationStatus => value in RECONCILIATION_STATUS_META

/** Una fila del agregado: las OC de un mes de emisión en un estado. */
export interface ReconciliationRow {
  /** «YYYY-MM» del mes de emisión (hora de Chile). */
  month: string
  status: string
  count: number
  /** Σ max(0, OC − facturado) de esas OC. */
  toInvoice: number
  /** OC con algo por facturar (saldo > 0). */
  withBalance: number
}

export interface ReconciliationMonth {
  month: string
  label: string
  counts: Record<ReconciliationStatus, number>
  total: number
  toInvoice: number
  withBalance: number
  /** El mes en curso: todavía se emiten OC. */
  partial: boolean
}

export interface ReconciliationShape {
  months: ReconciliationMonth[]
  totalOrders: number
  toInvoice: number
  ordersWithBalance: number
  needsReview: number
}

const emptyCounts = (): Record<ReconciliationStatus, number> => ({
  needs_review: 0, partially_invoiced: 0, awaiting_receipt: 0, no_invoices: 0, accepted_exception: 0, matched: 0,
})

/**
 * Una entrada por mes de la ventana, con ceros donde no hubo OC. Lo que cae fuera
 * de la ventana o trae un estado que el vocabulario no conoce no se cuenta.
 */
export function shapeReconciliationMonths(rows: readonly ReconciliationRow[], months: readonly string[], today: string): ReconciliationShape {
  const currentMonth = today.slice(0, 7)
  const byMonth = new Map<string, ReconciliationMonth>(months.map((month) => [month, {
    month, label: monthLabel(month), counts: emptyCounts(), total: 0, toInvoice: 0, withBalance: 0, partial: month === currentMonth,
  }]))
  for (const row of rows) {
    const entry = byMonth.get(row.month)
    if (!entry || !isStatus(row.status)) continue
    const count = cleanCount(row.count)
    entry.counts[row.status] += count
    entry.total += count
    entry.toInvoice += cleanAmount(row.toInvoice)
    entry.withBalance += cleanCount(row.withBalance)
  }
  const list = months.map((month) => byMonth.get(month)!)
  return {
    months: list,
    totalOrders: list.reduce((sum, month) => sum + month.total, 0),
    toInvoice: list.reduce((sum, month) => sum + month.toInvoice, 0),
    ordersWithBalance: list.reduce((sum, month) => sum + month.withBalance, 0),
    needsReview: list.reduce((sum, month) => sum + month.counts.needs_review, 0),
  }
}

/**
 * La respuesta del gráfico: cuánto queda por facturar y cuántas OC piden
 * revisión. `null` sin ninguna OC (el gráfico explica el vacío).
 */
export function reconciliationSummary(shape: ReconciliationShape, windowMonths = shape.months.length): string | null {
  const { totalOrders, toInvoice, ordersWithBalance, needsReview } = shape
  if (totalOrders === 0) return null
  const window = windowText(windowMonths)
  const scope = totalOrders === 1 ? "la única OC emitida" : `${ordersWithBalance.toLocaleString("es-CL")} de ${totalOrders.toLocaleString("es-CL")} OC emitidas`
  const balance = toInvoice > 0
    ? `Quedan ${formatCLP(toInvoice)} por facturar en ${scope} en ${window}.`
    : `No queda nada por facturar en ${totalOrders === 1 ? "la única OC emitida" : `las ${totalOrders.toLocaleString("es-CL")} OC emitidas`} en ${window}.`
  const review = needsReview > 0
    ? `${needsReview.toLocaleString("es-CL")} ${needsReview === 1 ? "requiere" : "requieren"} revisión.`
    : "Ninguna requiere revisión."
  return `${balance} ${review}`
}

/** Alternativa en datos («Ver datos»): un renglón por mes con cada estado. */
export function reconciliationTable(shape: ReconciliationShape): { headers: string[]; rows: Array<Array<string | number>> } {
  return {
    headers: ["Mes de emisión", ...RECONCILIATION_STATUS_ORDER.map((status) => RECONCILIATION_STATUS_META[status].label), "Total", "Por facturar"],
    rows: shape.months.map((month) => [
      rowLabel(month.month, month.partial),
      ...RECONCILIATION_STATUS_ORDER.map((status) => month.counts[status]),
      month.total,
      formatCLP(month.toInvoice),
    ]),
  }
}

// ── Cobertura de DTE ─────────────────────────────────────────────────────────

/** `oc` vinculado a una factura de OC · `combustible` a una carga · `none` sin vincular. */
export type DteLink = "oc" | "combustible" | "none"

export const DTE_LINK_ORDER: readonly DteLink[] = ["oc", "combustible", "none"]

/** Mismas palabras que las insignias de la lista (`Vinculado a OC`, `Sin vínculo`). */
export const DTE_LINK_META: Record<DteLink, { label: string; color: string; param: string }> = {
  oc: { label: "Vinculado a OC", color: "var(--color-success)", param: "oc" },
  combustible: { label: "Vinculado a combustible", color: "var(--color-info)", param: "combustible" },
  none: { label: "Sin vincular", color: "var(--color-signal)", param: "sin_oc" },
}

export const dteLinkColor = (link: DteLink): string => DTE_LINK_META[link].color
const isLink = (value: string): value is DteLink => value in DTE_LINK_META

/** Destino de una barra: la lista del mismo período y vínculo, que cuenta lo mismo que el gráfico. */
export function dteListHref(periodo: string, link: DteLink): string {
  return `/compras/dte?periodo=${periodo}&vinculo=${DTE_LINK_META[link].param}`
}

export interface DteCoverageRow {
  /** Período de sincronización «YYYY-MM» (el mismo con que la lista filtra). */
  periodo: string
  link: string
  count: number
  /** Σ del monto total; una nota de crédito viene negativa y resta. */
  amount: number
}

export interface DteCoverageMonth {
  month: string
  label: string
  counts: Record<DteLink, number>
  amounts: Record<DteLink, number>
  total: number
  partial: boolean
}

export interface DteCoverageShape {
  months: DteCoverageMonth[]
  total: number
  byLink: Record<DteLink, { count: number; amount: number }>
}

export function shapeDteCoverage(rows: readonly DteCoverageRow[], months: readonly string[], today: string): DteCoverageShape {
  const currentMonth = today.slice(0, 7)
  const zero = (): Record<DteLink, number> => ({ oc: 0, combustible: 0, none: 0 })
  const byMonth = new Map<string, DteCoverageMonth>(months.map((month) => [month, {
    month, label: monthLabel(month), counts: zero(), amounts: zero(), total: 0, partial: month === currentMonth,
  }]))
  const byLink: DteCoverageShape["byLink"] = { oc: { count: 0, amount: 0 }, combustible: { count: 0, amount: 0 }, none: { count: 0, amount: 0 } }
  for (const row of rows) {
    const entry = byMonth.get(row.periodo)
    if (!entry || !isLink(row.link)) continue
    const count = cleanCount(row.count)
    const amount = Number.isFinite(row.amount) ? row.amount : 0
    entry.counts[row.link] += count
    entry.amounts[row.link] += amount
    entry.total += count
    byLink[row.link].count += count
    byLink[row.link].amount += amount
  }
  const list = months.map((month) => byMonth.get(month)!)
  return { months: list, total: list.reduce((sum, month) => sum + month.total, 0), byLink }
}

/** Debajo de este n no se da un porcentaje. */
export const DTE_MIN_FOR_RATE = 10

/**
 * La respuesta del gráfico: cuántos DTE siguen sin vincular y por cuánto. La tasa
 * lleva su n y con pocos documentos no se calcula (datos insuficientes).
 */
export function dteCoverageSummary(shape: DteCoverageShape, windowMonths = shape.months.length): string | null {
  const { total } = shape
  if (total === 0) return null
  const window = windowText(windowMonths)
  const none = shape.byLink.none
  if (none.count === 0) {
    return total === 1
      ? `El único DTE de ${window} está vinculado a una OC o a una carga de combustible.`
      : `Los ${total.toLocaleString("es-CL")} DTE de ${window} están vinculados a una OC o a una carga de combustible.`
  }
  const enoughForRate = total >= DTE_MIN_FOR_RATE
  const head = total === 1
    ? "el único DTE"
    : `${none.count.toLocaleString("es-CL")} de ${total.toLocaleString("es-CL")} DTE${enoughForRate ? ` (${formatPercent((none.count / total) * 100, 0)})` : ""}`
  const verb = none.count === 1 ? "no está vinculado" : "no están vinculados"
  const amount = none.amount !== 0 ? `, por ${formatCLP(none.amount)}` : ""
  const caveat = enoughForRate || total === 1 ? "" : ` Son pocos documentos: datos insuficientes para un porcentaje (n = ${total}).`
  const sentence = `${head} de ${window} ${verb} a una OC ni a una carga de combustible${amount}.`
  return `${sentence[0]!.toUpperCase()}${sentence.slice(1)}${caveat}`
}

/** Alternativa en datos («Ver datos»): cantidades por vínculo y el monto que sigue sin vincular. */
export function dteCoverageTable(shape: DteCoverageShape): { headers: string[]; rows: Array<Array<string | number>> } {
  return {
    headers: ["Período", "A OC", "A combustible", "Sin vincular", "Total", "Monto sin vincular"],
    rows: shape.months.map((month) => [
      rowLabel(month.month, month.partial),
      month.counts.oc,
      month.counts.combustible,
      month.counts.none,
      month.total,
      formatCLP(month.amounts.none),
    ]),
  }
}
