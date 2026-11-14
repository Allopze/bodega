import type { Session } from "next-auth"
import { getFuelMonthlyTrend, isPartialMonth, type FuelMonthlyPoint } from "@/lib/services/dashboard-fuel"
import { todayInChile } from "@/lib/utils"
import { MAX_LEDGER_MONTHS } from "./view"

/**
 * Libro del proveedor (Copec) por mes: litros, costo y cargas, con hueco —no cero— donde
 * el proveedor no informó el mes. Es `getFuelMonthlyTrend` (la misma serie del tablero de
 * Inicio) con la ventana corrida: aquella cuenta los meses hacia atrás desde hoy, y estos
 * indicadores terminan donde termina el período que la persona eligió.
 *
 * La consulta existente no recibe el mes final, pero sí «ahora»: se le pasa un instante a
 * mitad del último mes de la ventana y ella resuelve los límites de cada mes en hora de
 * Chile. El único dato que depende de «ahora» y no de la ventana es `partial` (¿el mes
 * todavía no termina?): con el instante simulado quedaría mal, así que se vuelve a
 * calcular con el día de hoy real.
 */

export function ledgerReferenceInstant(lastMonth: string): Date {
  // 15:00 UTC del día 15 es mediodía en Chile en cualquier época del año: el mes civil es el pedido.
  return new Date(`${lastMonth}-15T15:00:00.000Z`)
}

export async function getLedgerTrend(
  session: Session,
  options: { lastMonth: string; months: number; worksiteId?: string; today?: string },
): Promise<FuelMonthlyPoint[]> {
  const months = Math.min(MAX_LEDGER_MONTHS, Math.max(1, Math.floor(options.months)))
  const today = options.today ?? todayInChile()
  const points = await getFuelMonthlyTrend(session, months, options.worksiteId, ledgerReferenceInstant(options.lastMonth))
  return points.map((point) => ({ ...point, partial: isPartialMonth(point.monthKey, today) }))
}
