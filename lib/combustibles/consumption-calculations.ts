/**
 * Cálculos derivados para el dashboard de consumos de combustible por patente.
 * Capa reutilizable — no recalcular estas fórmulas en componentes de UI.
 * Todas las funciones manejan división por cero devolviendo 0/null en vez de
 * NaN/Infinity, para que la interfaz nunca rompa por falta de datos.
 */

export interface ConsumptionRowLike {
  cantidadUnidad: number
  monto: number
  rendimientoPromedio: number
  numeroTransacciones: number
  numeroTarjetas: number
}

export interface BatchTotals {
  totalFilas: number
  totalPatentes: number
  totalTarjetas: number
  totalTransacciones: number
  totalCantidad: number
  totalMonto: number
}

/** Precio promedio por unidad (litro): monto / cantidad. 0 si no hay cantidad. */
export function calcPrecioPromedioUnidad(monto: number, cantidadUnidad: number): number | null {
  if (cantidadUnidad <= 0) return null
  return roundCLP(monto / cantidadUnidad)
}

/** Rendimiento promedio ponderado por cantidad consumida: Σ(rend·cant) / Σcant. */
export function calcRendimientoPonderado(rows: ConsumptionRowLike[]): number {
  const totalCantidad = rows.reduce((sum, r) => sum + r.cantidadUnidad, 0)
  if (totalCantidad <= 0) return 0
  const weighted = rows.reduce((sum, r) => sum + r.rendimientoPromedio * r.cantidadUnidad, 0)
  return round(weighted / totalCantidad, 2)
}

/** Variación porcentual entre el periodo actual y el anterior. null si no hay
 *  dato del periodo anterior o este es 0 (división indefinida). */
export function calcVariacion(actual: number, anterior: number | null | undefined): number | null {
  if (anterior == null || anterior === 0) return null
  return round(((actual - anterior) / anterior) * 100, 1)
}

/** Totales de un lote (o de cualquier conjunto de filas de consumo). */
export function computeBatchTotals(rows: Array<ConsumptionRowLike & { patente: string }>): BatchTotals {
  const totalPatentes = new Set(rows.map((r) => r.patente)).size
  return {
    totalFilas: rows.length,
    totalPatentes,
    totalTarjetas: rows.reduce((sum, r) => sum + r.numeroTarjetas, 0),
    totalTransacciones: rows.reduce((sum, r) => sum + r.numeroTransacciones, 0),
    totalCantidad: round(rows.reduce((sum, r) => sum + r.cantidadUnidad, 0), 4),
    totalMonto: roundCLP(rows.reduce((sum, r) => sum + r.monto, 0)),
  }
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function roundCLP(value: number): number {
  return round(value, 2)
}
