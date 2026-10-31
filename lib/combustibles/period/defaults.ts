import { todayInChile } from "@/lib/utils"
import { currentMonthPeriod, currentWeekPeriod } from "./parse"
import type { FuelPeriod } from "./types"

/**
 * Período con que abre el módulo cuando la URL y la cookie no dicen nada.
 *
 * Quien registra cargas pero no decide (terreno, administración de contrato)
 * trabaja la semana; la jefatura y los roles de consulta, el mes. Lee los
 * permisos de la sesión directamente en vez de usar `can()`, que importa
 * `next/headers` y no puede viajar a un Client Component.
 */
export function defaultFuelPeriodFor(
  session: { user?: { permissions?: readonly string[] } } | null | undefined,
  today = todayInChile(),
): FuelPeriod {
  const permissions = session?.user?.permissions ?? []
  const fieldRole = permissions.includes("combustibles:register_load") && !permissions.includes("combustibles:approve_flagged")
  return fieldRole ? currentWeekPeriod(today) : currentMonthPeriod(today)
}
