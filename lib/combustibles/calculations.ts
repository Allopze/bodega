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

export type StatementDisplayStatus = "open" | "partial" | "paid" | "overdue" | "cancelled"

/**
 * "Vencido" NUNCA se persiste en `fuel_monthly_statements.status` — nadie lo
 * escribe (grep confirmado en todo el módulo). Antes cada consumidor lo
 * recalculaba a su manera: `notifications.ts` con su propia comparación de
 * fecha (y en UTC), `statements-table.tsx` mostraba crudo el status de la
 * fila y por eso NUNCA mostraba "Vencido" pese a tener el label listo. Un
 * único cálculo, con `today` inyectado (usar `todayInChile()`) para que
 * server y cliente no puedan divergir por zona horaria.
 *
 * `cancelled` no se deriva aquí: no existe ninguna acción de "cancelar" un
 * resumen en el repo, así que ese estado queda para cuando exista.
 */
export function getStatementDisplayStatus(
  statement: { status: string; dueDate: string | null; totalAmount: number; paidAmount: number },
  today: string,
): StatementDisplayStatus {
  if (statement.status === "paid" || statement.status === "cancelled") return statement.status as StatementDisplayStatus
  const pending = roundCLP(statement.totalAmount - statement.paidAmount)
  if (pending <= 0) return "paid"
  if (statement.dueDate && statement.dueDate < today) return "overdue"
  return statement.status === "partial" ? "partial" : "open"
}
