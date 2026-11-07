import type { Session } from "next-auth"
import { and, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelProviderTransactions, fuelVehicles } from "@/db/schema"
import { can } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { monthsWithoutProviderData } from "@/lib/combustibles/copec-coverage"
import { listCopecPeriodCoverage } from "@/lib/combustibles/copec-coverage-store"
import { accountableProviderTransactionsWhere } from "@/lib/combustibles/load-status"
import { isPartialMonth } from "@/lib/services/dashboard-fuel"
import { todayInChile } from "@/lib/utils"

/**
 * Qué meses de la ventana de un gráfico de combustible no tienen datos del proveedor o
 * están incompletos: el insumo de `CoverageNotice` (Fase 4, CHART-022).
 *
 * Es la **misma vara** con que Analítica, el tablero, Flota y el rendimiento por mes dibujan un
 * hueco —`monthsWithoutProviderData` sobre la cobertura de Copec y los meses con transacciones
 * contabilizables—, así que el aviso nunca discrepa del gráfico que acompaña. Antes la
 * consulta estaba copiada en `getFleetProviderGapMonths`, en `getFuelMonthlyTrend` y en
 * `getMeterRateSeries`; las pantallas nuevas la piden aquí.
 *
 * - **Hueco** (`gapMonths`): ni transacciones aceptadas ni cobertura que cierre el mes.
 * - **Parcial** (`partialMonths`): el mes en curso (`isPartialMonth`, la misma regla que marca
 *   la columna tenue del gráfico) que ya trae datos; un mes que es hueco no se repite aquí.
 *
 * El alcance de faena es el de la sesión (`worksiteScopeSql`): la brecha es del proveedor, pero
 * los meses «con filas» se miran en lo que esa persona puede ver, igual que su gráfico. Sin
 * `combustibles:view` no hay cifras de combustible que advertir y devuelve vacío.
 */
export interface FuelCoverageGaps {
  gapMonths: string[]
  partialMonths: string[]
}

export async function getFuelProviderCoverageGaps(
  session: Session,
  monthKeys: readonly string[],
  options: {
    worksiteId?: string
    /** Hoy en Chile; por defecto `todayInChile()`. Decide qué mes es el parcial. */
    today?: string
    /**
     * Primer día (`YYYY-MM-DD`) que cuentan las cifras. Un mes sólo tiene respaldo por filas de
     * esa fecha en adelante: Flota suma «12 meses» desde un día a mitad de mes y su primer mes
     * no puede darse por respaldado con filas anteriores a la ventana.
     */
    fromDate?: string
    /**
     * Flota: la cobertura sigue al EQUIPO, no al `worksite_id` histórico de la
     * transacción. Los gráficos de combustible conservan el criterio de la
     * transacción (su unidad es la faena del gasto).
     */
    byVehicleWorksite?: boolean
  } = {},
): Promise<FuelCoverageGaps> {
  const months = [...new Set(monthKeys)].sort()
  if (months.length === 0 || !can(session, "combustibles:view")) return { gapMonths: [], partialMonths: [] }

  const t = fuelProviderTransactions
  const monthSql = sql<string>`left(${t.occurredAt}, 7)`
  const rowsQuery = (async () => {
    const base = options.byVehicleWorksite
      ? db.select({ month: monthSql }).from(t).innerJoin(fuelVehicles, eq(t.vehicleId, fuelVehicles.id))
      : db.select({ month: monthSql }).from(t)
    return base
      .where(and(
        accountableProviderTransactionsWhere(),
        sql`${monthSql} >= ${months[0]!} and ${monthSql} <= ${months[months.length - 1]!}`,
        options.fromDate ? sql`left(${t.occurredAt}, 10) >= ${options.fromDate}` : undefined,
        options.byVehicleWorksite
          ? worksiteScopeSql(session, fuelVehicles.worksiteId, options.worksiteId)
          : worksiteScopeSql(session, t.worksiteId, options.worksiteId),
      ))
      .groupBy(monthSql)
  })()
  const [monthsWithRows, coverage] = await Promise.all([
    rowsQuery,
    listCopecPeriodCoverage(`${months[0]}-01`, `${months[months.length - 1]}-01`),
  ])

  const withRows = new Set(monthsWithRows.map((row) => row.month))
  const gaps = monthsWithoutProviderData(months, coverage, withRows)
  const today = options.today ?? todayInChile()
  return {
    gapMonths: months.filter((month) => gaps.has(month)),
    partialMonths: months.filter((month) => !gaps.has(month) && isPartialMonth(month, today)),
  }
}
