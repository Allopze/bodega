import { MONTH_NAMES, formatCLP, formatDate, formatDateRelative, formatPercent } from "@/lib/utils"

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
 * Calcula totales de un estado de cuenta mensual a partir de las cargas.
 *
 * La vista previa de «Pagos › Estados de cuenta» y la acción que lo crea
 * llaman a esta misma función: lo que se ve antes de confirmar es lo que se
 * guarda, redondeo incluido.
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

/** Lo que falta pagar de un estado de cuenta; nunca negativo. */
export function statementPendingAmount(statement: { totalAmount: number; paidAmount: number }): number {
  return Math.max(0, roundCLP(statement.totalAmount - statement.paidAmount))
}

/** "2026-09" → "Septiembre 2026". Una clave que no es un mes se devuelve tal cual. */
export function fuelMonthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number)
  const name = monthNumber ? MONTH_NAMES[monthNumber - 1] : undefined
  if (!year || !name) return month
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`
}

/**
 * El estado de un estado de cuenta dicho en una frase, para que quien abre el
 * detalle no tenga que deducirlo de cuatro cifras: cuánto se pagó, cuánto falta
 * y para cuándo. `today` es la fecha civil de Chile (`todayInChile()`).
 */
export function describeStatementStatus(
  statement: { status: string; dueDate: string | null; totalAmount: number; paidAmount: number },
  today: string,
): string {
  const display = getStatementDisplayStatus(statement, today)
  const pending = statementPendingAmount(statement)
  const due = statement.dueDate
  switch (display) {
    case "cancelled":
      return "Este estado de cuenta está anulado."
    case "paid":
      return `Pagado por completo: ${formatCLP(statement.totalAmount)}.`
    case "overdue":
      return `Venció el ${formatDate(due ?? "")} (${formatDateRelative(due, today)}) y faltan ${formatCLP(pending)} por pagar.`
    case "partial": {
      const share = statement.totalAmount > 0 ? (statement.paidAmount / statement.totalAmount) * 100 : 0
      const when = due ? ` y vence el ${formatDate(due)} (${formatDateRelative(due, today)})` : ""
      return `Se pagó el ${formatPercent(share, 0)} (${formatCLP(statement.paidAmount)} de ${formatCLP(statement.totalAmount)}). Faltan ${formatCLP(pending)}${when}.`
    }
    default: {
      const when = due ? `; vence el ${formatDate(due)} (${formatDateRelative(due, today)})` : " (sin fecha de vencimiento)"
      return `Sin pagos registrados. Se debe ${formatCLP(pending)}${when}.`
    }
  }
}
