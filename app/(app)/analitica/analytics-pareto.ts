import type { RankingRow } from "@/lib/services/analytics"
import { formatPercent } from "@/lib/utils"

/**
 * Forma de datos del Pareto de proveedores (CHART-033), sin dibujo: el gráfico y la
 * frase-respuesta leen de acá, y es lo que prueba `analytics-pareto.test.ts`.
 *
 * Qué es un Pareto aquí: barras de un tono con el gasto de cada proveedor, de mayor a menor,
 * y una línea con el **% acumulado del gasto total**. Responde cuánto depende el gasto de pocos
 * proveedores. «Otros proveedores» = gasto total − lo listado; sin esa fila el acumulado
 * se calcularía contra la suma de los visibles y sobreestimaría el peso de cada uno (el 100 %
 * de la lista no sería el 100 % del gasto).
 *
 * El ranking mezcla proveedores de compras y de combustible (el gasto total también): cada fila
 * conserva su `module` para que la tabla lo diga.
 */

export const OTHER_SUPPLIERS_KEY = "otros"

/** Proveedores que se listan por nombre; el resto va en «Otros proveedores». */
export const PARETO_MAX_SUPPLIERS = 10

export interface ParetoRow {
  key: string
  label: string
  /** «Compras» o «Combustible»; `null` en «Otros proveedores», que mezcla. */
  module: string | null
  amount: number
  count: number
  /** % del gasto total (0–100). */
  sharePct: number
  /** % acumulado del gasto total, hasta esta fila inclusive (0–100). */
  cumulativePct: number
  isOther: boolean
}

export interface SupplierPareto {
  rows: ParetoRow[]
  /** Gasto contra el que se calculan los porcentajes. */
  totalSpend: number
}

export function buildSupplierPareto({ suppliers, totalSpend }: { suppliers: readonly RankingRow[]; totalSpend: number }): SupplierPareto {
  const listed = suppliers
    .filter((row) => row.totalAmount > 0)
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, PARETO_MAX_SUPPLIERS)
  const listedSum = listed.reduce((sum, row) => sum + row.totalAmount, 0)
  // Con proveedores que suman más que el total (dos cortes de datos distintos) el total manda a
  // la baja: un acumulado de 105 % no es un dato, es un error visible.
  const total = Math.max(totalSpend, listedSum)
  if (total <= 0 || listed.length === 0) return { rows: [], totalSpend: Math.max(totalSpend, 0) }

  const base = listed.map((row) => ({
    key: row.id,
    label: row.name,
    module: row.module ?? null,
    amount: row.totalAmount,
    count: row.count,
    isOther: false,
  }))
  const remainder = total - listedSum
  // Menos de un peso es redondeo, no «otros proveedores».
  if (remainder >= 1) {
    base.push({ key: OTHER_SUPPLIERS_KEY, label: "Otros proveedores", module: null, amount: remainder, count: 0, isOther: true })
  }

  let running = 0
  const rows = base.map((row) => {
    running += row.amount
    return { ...row, sharePct: (row.amount / total) * 100, cumulativePct: Math.min(100, (running / total) * 100) }
  })
  return { rows, totalSpend: total }
}

/**
 * La frase que responde la pregunta del gráfico. Se arma de los mismos números que se dibujan:
 * «los N mayores» usa los N proveedores que de verdad hay (no promete tres si hay dos) y «Otros
 * proveedores» no cuenta como uno. La alerta nombra el umbral configurado cuando el mayor lo
 * alcanza, que es la condición exacta de la alerta «proveedor concentrado». `base` dice contra qué
 * gasto se mide: sin permiso de costos de combustible el gasto es sólo el de compras, y la frase
 * no puede llamarlo «el gasto» a secas.
 */
export function paretoSummary(pareto: SupplierPareto, thresholdPct: number, base = "del gasto"): string {
  const suppliers = pareto.rows.filter((row) => !row.isOther)
  const top = suppliers[0]
  if (!top) return ""
  const pct = (value: number) => formatPercent(Math.round(value), 0)
  const topCount = Math.min(3, suppliers.length)
  const topShare = suppliers.slice(0, topCount).reduce((sum, row) => sum + row.sharePct, 0)
  const head = suppliers.length === 1
    ? `${top.label} concentra el ${pct(top.sharePct)} ${base}.`
    : `${top.label} concentra el ${pct(top.sharePct)} ${base}; los ${topCount} mayores proveedores, el ${pct(topShare)}.`
  return top.sharePct >= thresholdPct ? `${head} Supera el umbral de concentración (${formatPercent(thresholdPct, 0)}).` : head
}

/** Marcas del eje de % acumulado: de 0 a 100 y, además, el umbral de concentración. */
export function paretoYAxisTicks(thresholdPct: number): number[] {
  return [...new Set([0, 25, 50, 75, 100, Math.round(thresholdPct)])].sort((a, b) => a - b)
}
