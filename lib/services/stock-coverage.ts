import type { Session } from "next-auth"
import { and, desc, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { inventoryMovements, products } from "@/db/schema"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { COVERAGE_WINDOW_DAYS } from "@/lib/bodega/stock-coverage"
import type { BalanceMovement } from "@/lib/bodega/balance-series"

/**
 * Consultas de los gráficos de stock de Bodega (CHART-035). Las reglas de lo que
 * significa cada número viven en `lib/bodega/stock-coverage.ts` y
 * `lib/bodega/balance-series.ts`; aquí sólo se leen los insumos, siempre acotados
 * a las faenas de la sesión con `worksiteScopeSql` (la misma intersección que usa
 * el resto de la pantalla: una faena fuera del permiso devuelve cero filas).
 */

const DAY_MS = 86_400_000

export interface StockConsumptionRow {
  worksiteId: string
  productId: string
  /** Consumo neto de la ventana: entregas y bajas, menos el reverso de entregas anuladas. */
  consumed: number
  /** Salidas netas de la ventana (el n que respalda el ritmo). */
  events: number
  /** Días desde el primer movimiento del producto en la faena; `null` si no tiene ninguno. */
  historyDays: number | null
}

export const stockConsumptionKey = (worksiteId: string, productId: string): string => `${worksiteId}\u0000${productId}`

/**
 * Consumo de los últimos 90 días por faena y producto.
 *
 * Se mide con el **efecto** sobre el saldo (`stock_before - stock_after`) y no con
 * `quantity`: `egreso_desecho` guarda su signo, `egreso_entrega` depende del flujo
 * y una baja que se recorta al saldo disponible sólo restó lo que había. El
 * reverso de una entrega anulada (`ingreso_anulacion`) resta del consumo: ese
 * material nunca salió. La salida por guía (`egreso_traslado`) no cuenta: el
 * producto sigue existiendo en otra faena.
 */
export async function getStockConsumption(
  session: Session | null,
  options: { worksiteId?: string; now?: Date } = {},
): Promise<Map<string, StockConsumptionRow>> {
  const now = options.now ?? new Date()
  const nowIso = now.toISOString()
  const sinceIso = new Date(now.getTime() - COVERAGE_WINDOW_DAYS * DAY_MS).toISOString()
  const inWindow = sql`${inventoryMovements.performedAt} >= ${sinceIso}::timestamptz`
  const isExit = sql`${inventoryMovements.type} in ('egreso_entrega', 'egreso_desecho')`
  const exitEffect = sql`greatest(${inventoryMovements.stockBefore} - ${inventoryMovements.stockAfter}, 0)`
  const reversalEffect = sql`greatest(${inventoryMovements.stockAfter} - ${inventoryMovements.stockBefore}, 0)`
  const reverses = sql`${inventoryMovements.type} = 'ingreso_anulacion'`

  const rows = await db
    .select({
      worksiteId: inventoryMovements.worksiteId,
      productId: inventoryMovements.productId,
      consumed: sql<number>`coalesce(sum(case when ${inWindow} then
        case when ${isExit} then ${exitEffect} when ${reverses} then -${reversalEffect} else 0 end
        else 0 end), 0)`,
      events: sql<number>`coalesce(sum(case when ${inWindow} then
        case when ${isExit} and ${exitEffect} > 0 then 1 when ${reverses} and ${reversalEffect} > 0 then -1 else 0 end
        else 0 end), 0)`,
      historyDays: sql<number | null>`floor(extract(epoch from (${nowIso}::timestamptz - min(${inventoryMovements.performedAt}))) / 86400)`,
    })
    .from(inventoryMovements)
    .where(worksiteScopeSql(session, inventoryMovements.worksiteId, options.worksiteId))
    .groupBy(inventoryMovements.worksiteId, inventoryMovements.productId)

  const byKey = new Map<string, StockConsumptionRow>()
  for (const row of rows) {
    byKey.set(stockConsumptionKey(row.worksiteId, row.productId), {
      worksiteId: row.worksiteId,
      productId: row.productId,
      consumed: Math.max(0, Number(row.consumed ?? 0)),
      events: Math.max(0, Number(row.events ?? 0)),
      historyDays: row.historyDays === null || row.historyDays === undefined ? null : Math.max(0, Number(row.historyDays)),
    })
  }
  return byKey
}

/** Tope de movimientos que dibuja el gráfico del saldo. */
export const BALANCE_MOVEMENT_LIMIT = 1_000

export interface ProductBalanceMovements {
  movements: BalanceMovement[]
  /** Había más que el tope: la serie conserva los más recientes. */
  truncated: boolean
  /** Unidad de medida del producto, para rotular las cantidades. */
  unit: string
}

/**
 * Movimientos de un producto en una faena dentro de la ventana `[from, to]`
 * (días civiles de Chile), en orden cronológico. Con más de `limit` se
 * conservan los más recientes y se avisa: un saldo calculado con la cola
 * cortada diría un número que no es.
 */
export async function getProductBalanceMovements(
  session: Session | null,
  params: { worksiteId: string; productId: string; from: string; to: string; limit?: number },
): Promise<ProductBalanceMovements> {
  const limit = params.limit ?? BALANCE_MOVEMENT_LIMIT
  const chileDay = sql`(${inventoryMovements.performedAt} at time zone 'America/Santiago')::date`
  const [rows, unitRow] = await Promise.all([
    db
      .select({
        performedAt: sql<string>`to_char(${inventoryMovements.performedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
        stockBefore: inventoryMovements.stockBefore,
        stockAfter: inventoryMovements.stockAfter,
      })
      .from(inventoryMovements)
      .where(and(
        worksiteScopeSql(session, inventoryMovements.worksiteId, params.worksiteId),
        eq(inventoryMovements.worksiteId, params.worksiteId),
        eq(inventoryMovements.productId, params.productId),
        sql`${chileDay} >= ${params.from}::date`,
        sql`${chileDay} <= ${params.to}::date`,
      ))
      .orderBy(desc(inventoryMovements.performedAt), desc(inventoryMovements.id))
      .limit(limit + 1),
    db.select({ unit: products.unitOfMeasure }).from(products).where(eq(products.id, params.productId)).limit(1),
  ])

  const truncated = rows.length > limit
  const kept = (truncated ? rows.slice(0, limit) : rows).reverse()
  return {
    movements: kept.map((row) => ({
      performedAt: String(row.performedAt),
      stockBefore: Number(row.stockBefore),
      stockAfter: Number(row.stockAfter),
    })),
    truncated,
    unit: unitRow[0]?.unit ?? "unidad",
  }
}
