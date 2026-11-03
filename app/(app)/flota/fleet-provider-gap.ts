import { formatTrendMonthList } from "@/app/(app)/analitica/analytics-trend"

/**
 * Aviso de que la ventana de cifras de Flota («Costo combustible (12 meses)», litros, cargas y
 * las columnas por equipo) tiene meses en que el proveedor no trajo datos (C-4): esas cifras
 * suman sólo lo que Copec informó, y un mes sin informe no es «no se cargó combustible».
 *
 * Una sola redacción para el resumen de la pantalla y la hoja «Metadatos» de la exportación.
 * `null` cuando no falta ningún mes. Los meses vienen de `getFleetProviderGapMonths`.
 */
export function fleetProviderGapNotice(gapMonths: readonly string[], lookbackMonths: number): string | null {
  if (gapMonths.length === 0) return null
  return `Sin datos del proveedor en ${formatTrendMonthList(gapMonths)}: los totales de ${lookbackMonths} meses no incluyen ${gapMonths.length === 1 ? "ese mes" : "esos meses"}.`
}
