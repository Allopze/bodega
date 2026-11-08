/**
 * Guarda de bajas: último día con actividad en Chome de cada candidato a baja.
 *
 * Un finiquito de Talana sólo da de baja si la persona no hizo nada en Chome
 * después de su término. En el sondeo de 2026-11, 2 de 44 finiquitados habían
 * recibido EPP 33 y 133 días después del término: los recontrataron sin
 * registrarlo en Talana. Cada señal es algo en lo que la persona participó, con
 * su trabajador y su fecha, sin lo anulado. Un falso positivo sólo frena una
 * baja, que es la dirección segura.
 *
 * `sst_evaluations` queda fuera: guarda la fecha como texto.
 */
import { sql } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import { todayInChile } from "@/lib/utils"

type Client = DB | Tx

export async function loadLastActivityByWorker(workerIds: string[], client: Client = db): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = [...new Set(workerIds)].filter(Boolean)
  if (ids.length === 0) return out
  const list = sql.join(ids.map((id) => sql`${id}`), sql`, `)
  const result = await client.execute<{ worker_id: string; last_at: string | Date }>(sql`
    SELECT worker_id, max(at) AS last_at FROM (
      SELECT worker_id, delivered_at AS at FROM deliveries
        WHERE worker_id IN (${list}) AND voided_at IS NULL
      UNION ALL
      SELECT tested_worker_id, performed_at FROM alcohol_tests
        WHERE tested_worker_id IN (${list})
      UNION ALL
      SELECT driver_worker_id, occurred_at FROM fuel_equipment_loads
        WHERE driver_worker_id IN (${list}) AND voided_at IS NULL
      UNION ALL
      SELECT supervisor_worker_id, occurred_at FROM fuel_equipment_loads
        WHERE supervisor_worker_id IN (${list}) AND voided_at IS NULL
      UNION ALL
      SELECT driver_worker_id, loaded_at FROM fuel_tae_submissions
        WHERE driver_worker_id IN (${list}) AND status <> 'voided'
      UNION ALL
      SELECT supervisor_worker_id, loaded_at FROM fuel_tae_submissions
        WHERE supervisor_worker_id IN (${list}) AND status <> 'voided'
      UNION ALL
      SELECT x.worker_id, COALESCE(g.received_at, g.dispatched_at) FROM dispatch_guides g
        CROSS JOIN LATERAL (VALUES (g.driver_worker_id), (g.receiver_worker_id), (g.received_by_worker_id), (g.dispatcher_worker_id)) AS x(worker_id)
        WHERE x.worker_id IN (${list}) AND g.status <> 'cancelled' AND COALESCE(g.received_at, g.dispatched_at) IS NOT NULL
      UNION ALL
      SELECT worker_id, COALESCE(filled_at, created_at) FROM ppa_submissions
        WHERE worker_id IN (${list}) AND estado <> 'cancelado'
      UNION ALL
      SELECT worker_id, acknowledged_at FROM prevention_permit_crew
        WHERE worker_id IN (${list}) AND acknowledged_at IS NOT NULL
    ) AS activity
    WHERE at IS NOT NULL
    GROUP BY worker_id
  `)
  const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as Array<{ worker_id: string; last_at: string | Date }>
  for (const row of rows) out.set(row.worker_id, todayInChile(row.last_at))
  return out
}
