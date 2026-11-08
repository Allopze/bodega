import { sql, type SQL } from "drizzle-orm"
import { itAssets } from "@/db/schema"

/**
 * Umbral único de «reparación demorada». Antes el tablero usaba 14 días y el
 * cron 30, así que un equipo con 20 días en taller aparecía en la tarjeta
 * «más de 14 días» pero no generaba ninguna alerta hasta el día 31.
 */
export const REPAIR_STUCK_DAYS = 14

/**
 * Momento en que empezó la reparación actual: el último movimiento de estado
 * del historial (o la última edición si el activo es anterior al historial).
 *
 * Se usa el historial y no `updatedAt` porque cualquier edición —cambiar una
 * nota, el proveedor, el costo— reiniciaba el contador y el equipo «salía» de
 * reparación demorada sin haber vuelto del taller.
 */
export function repairStartedAtSql(): SQL {
  return sql`coalesce(
    (SELECT max(h.created_at) FROM it_asset_history h
      WHERE h.asset_id = ${itAssets.id}
        AND h.action IN ('status_changed', 'assigned', 'returned')),
    ${itAssets.updatedAt}
  )`
}

/** Predicado compartido por el tablero, el cron y el filtro del inventario. */
export function repairStuckSql(): SQL {
  return sql`${repairStartedAtSql()} < now() - make_interval(days => ${REPAIR_STUCK_DAYS}::int)`
}
