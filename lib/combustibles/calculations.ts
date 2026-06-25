/**
 * Cálculos de impuestos para combustibles (Chile).
 *
 * IEC = Impuesto Especial al Consumo.
 * - IEC Fijo: tasa fija por litro (configurable en system_settings: "fuel:iec_fixed_rate")
 * - IEC Variable: tasa variable por litro (configurable en system_settings: "fuel:iec_variable_rate")
 * - IVA: 19% sobre base afecta
 *
 * Los usuarios pueden override cualquier valor calculado.
 */

export interface FuelCalculationInput {
  liters: number
  baseAmount: number
  iecFixedRate?: number | null    // CLP/litro. null = no configurado
  iecVariableRate?: number | null // CLP/litro. null = no configurado
  ivaRate?: number                // default 0.19
}

export interface FuelCalculationResult {
  iecFixed: number
  iecVariable: number
  iecTotal: number
  ivaAmount: number
  totalAmount: number
}

/**
 * Calcula IEC, IVA y Total a partir de litros y base afecta.
 * Si las tasas de IEC no están configuradas (null), devuelve 0 para esos campos.
 */
export function calculateFuelAmounts(input: FuelCalculationInput): FuelCalculationResult {
  const { liters, baseAmount, iecFixedRate, iecVariableRate, ivaRate = 0.19 } = input

  const iecFixed = iecFixedRate != null ? roundCLP(liters * iecFixedRate) : 0
  const iecVariable = iecVariableRate != null ? roundCLP(liters * iecVariableRate) : 0
  const iecTotal = roundCLP(iecFixed + iecVariable)
  const ivaAmount = roundCLP(baseAmount * ivaRate)
  const totalAmount = roundCLP(baseAmount + iecTotal + ivaAmount)

  return { iecFixed, iecVariable, iecTotal, ivaAmount, totalAmount }
}

/**
 * Redondea a 2 decimales (pesos chilenos).
 */
function roundCLP(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Calcula totales para una cuenta corriente mensual a partir de las cargas.
 */
export function calculateStatementTotals(
  loads: Array<{
    liters: number
    baseAmount: number
    iecTotal: number
    ivaAmount: number
    totalAmount: number
  }>
) {
  return loads.reduce(
    (acc, load) => ({
      totalLiters: roundCLP(acc.totalLiters + load.liters),
      totalBaseAmount: roundCLP(acc.totalBaseAmount + load.baseAmount),
      totalIec: roundCLP(acc.totalIec + load.iecTotal),
      totalIva: roundCLP(acc.totalIva + load.ivaAmount),
      totalAmount: roundCLP(acc.totalAmount + load.totalAmount),
    }),
    { totalLiters: 0, totalBaseAmount: 0, totalIec: 0, totalIva: 0, totalAmount: 0 }
  )
}
