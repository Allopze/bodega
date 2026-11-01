/** Bounded removal: refuses complex histories instead of deleting shared operations. */
import { createHash, randomUUID } from "node:crypto"

export interface SqlExecutor {
  query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>
}
type Inventory = { blockers: number; [key: string]: unknown }
type Options = { mode: "inventory" } | { mode: "apply"; actor: string; backupRef: string; expectedHash: string }

// Identity is bounded by verified identifiers. Names only flag candidates for review.
const target = `WITH target_suppliers AS (
  SELECT id FROM fuel_suppliers WHERE id = 'fs-esmax'
    OR regexp_replace(coalesce(rut, ''), '[^0-9kK]', '', 'g') = '795888705'

), target_media AS (
  SELECT id FROM fuel_supply_media WHERE id = 'fsm-aramco' OR provider_code = 'aramco'
    OR fuel_supplier_id IN (SELECT id FROM target_suppliers)

), target_runs AS (SELECT id FROM fuel_provider_sync_runs WHERE provider = 'aramco'),
target_operations AS (SELECT id, batch_id FROM fuel_operation_records WHERE fuel_supplier_id IN (SELECT id FROM target_suppliers))`

const inventorySql = `${target}
SELECT json_build_object(
 'sync_runs', (SELECT count(*) FROM target_runs),
 'run_ids', (SELECT coalesce(json_agg(id ORDER BY id), '[]'::json) FROM target_runs),
 'settings', (SELECT count(*) FROM system_settings WHERE key LIKE 'combustibles.aramco.%'),
 'settings_keys', (SELECT coalesce(json_agg(key ORDER BY key), '[]'::json) FROM system_settings WHERE key LIKE 'combustibles.aramco.%'),
 'cron_runs', (SELECT count(*) FROM cron_runs WHERE job_name = 'fuel-aramco-sync'),
 'cron_ids', (SELECT coalesce(json_agg(id ORDER BY id), '[]'::json) FROM cron_runs WHERE job_name = 'fuel-aramco-sync'),
 'suppliers', (SELECT count(*) FROM target_suppliers),
 'supplier_ids', (SELECT coalesce(json_agg(id ORDER BY id), '[]'::json) FROM target_suppliers),
 'media', (SELECT count(*) FROM target_media),
 'media_ids', (SELECT coalesce(json_agg(id ORDER BY id), '[]'::json) FROM target_media),
 'operation_ids', (SELECT coalesce(json_agg(id ORDER BY id), '[]'::json) FROM target_operations),
 'operation_batch_ids', (SELECT coalesce(json_agg(id ORDER BY id), '[]'::json) FROM fuel_operation_batches WHERE id IN (SELECT batch_id FROM target_operations)),
 'emptied_batch_ids', (SELECT coalesce(json_agg(b.id ORDER BY b.id), '[]'::json) FROM fuel_operation_batches b
   WHERE b.id IN (SELECT batch_id FROM target_operations) AND NOT EXISTS (
     SELECT 1 FROM fuel_operation_records r WHERE r.batch_id = b.id AND r.id NOT IN (SELECT id FROM target_operations)
   )),
 'operation_hashes', (SELECT coalesce(json_agg(md5(row_to_json(r)::text) ORDER BY r.id), '[]'::json) FROM fuel_operation_records r WHERE r.id IN (SELECT id FROM target_operations)),
 'operation_batch_hashes', (SELECT coalesce(json_agg(md5(row_to_json(b)::text) ORDER BY b.id), '[]'::json) FROM fuel_operation_batches b WHERE b.id IN (SELECT batch_id FROM target_operations)),
 'operation_batch_row_hashes', (SELECT coalesce(json_agg(md5(row_to_json(r)::text) ORDER BY r.id), '[]'::json) FROM fuel_operation_records r WHERE r.batch_id IN (SELECT batch_id FROM target_operations)),
 'blockers', (
   (SELECT count(*) FROM fuel_suppliers WHERE id = 'fs-esmax' AND regexp_replace(coalesce(rut, ''), '[^0-9kK]', '', 'g') <> '795888705') +
   (SELECT count(*) FROM fuel_supply_media WHERE id IN (SELECT id FROM target_media) AND provider_code IS DISTINCT FROM 'aramco') +
   (SELECT count(*) FROM fuel_suppliers WHERE lower(name) ~ '(aramco|esmax|petrobras)' AND id NOT IN (SELECT id FROM target_suppliers)) +
   (SELECT count(*) FROM fuel_supply_media WHERE lower(name) ~ '(aramco|esmax|petrobras)' AND id NOT IN (SELECT id FROM target_media)) +
   (SELECT count(*) FROM fuel_provider_sync_runs WHERE provider = 'aramco' AND status = 'running') +
   (SELECT count(*) FROM cron_runs WHERE job_name = 'fuel-aramco-sync' AND outcome = 'running') +
   (SELECT count(*) FROM fuel_provider_transactions WHERE provider = 'aramco' OR supplier_id IN (SELECT id FROM target_suppliers) OR sync_run_id IN (SELECT id FROM target_runs)) +
   (SELECT count(*) FROM fuel_provider_rejections WHERE provider = 'aramco' OR sync_run_id IN (SELECT id FROM target_runs)) +
   (SELECT count(*) FROM fuel_provider_mappings WHERE provider = 'aramco') +
   (SELECT count(*) FROM fuel_provider_files WHERE provider = 'aramco' OR sync_run_id IN (SELECT id FROM target_runs)) +
   (SELECT count(*) FROM fuel_provider_period_coverage WHERE provider = 'aramco' OR sync_run_id IN (SELECT id FROM target_runs)) +
   (SELECT count(*) FROM fuel_provider_event_revisions WHERE sync_run_id IN (SELECT id FROM target_runs)) +
   (SELECT count(*) FROM fuel_meter_readings WHERE source = 'aramco') +
   (SELECT count(*) FROM fuel_import_batches WHERE lower(fuente) ~ '(aramco|esmax|petrobras)') +
   (SELECT count(*) FROM fuel_consumption_records WHERE lower(coalesce(fuente, '')) ~ '(aramco|esmax|petrobras)') +
   (SELECT count(*) FROM fuel_loads WHERE fuel_supplier_id IN (SELECT id FROM target_suppliers)) +
   (SELECT count(*) FROM fuel_monthly_statements WHERE fuel_supplier_id IN (SELECT id FROM target_suppliers)) +
   (SELECT count(*) FROM fuel_cycle_movements WHERE supplier_id IN (SELECT id FROM target_suppliers)) +
   (SELECT count(*) FROM fuel_operation_records WHERE
      (id NOT IN (SELECT id FROM target_operations) AND lower(coalesce(proveedor_nombre, '')) ~ '(aramco|esmax|petrobras)') OR
      (id IN (SELECT id FROM target_operations) AND proveedor_nombre IS NOT NULL AND lower(proveedor_nombre) !~ '(aramco|esmax|petrobras)')) +
   (SELECT count(*) FROM fuel_equipment_loads WHERE operation_record_id IN (SELECT id FROM target_operations)) +
   (SELECT count(*) FROM fuel_operation_batches WHERE id IN (SELECT batch_id FROM target_operations) AND filas_invalidas > 0) +
   (SELECT count(*) FROM fuel_control_import_rejections WHERE batch_kind = 'operations' AND batch_id IN (SELECT batch_id FROM target_operations)) +
   (SELECT count(*) FROM fuel_anomaly_cases WHERE reference_entity_id IN (SELECT id FROM target_operations)) +
   (SELECT count(*) FROM fuel_review_marks WHERE entity_id IN (SELECT id FROM target_operations)) +
   (SELECT count(*) FROM fuel_vehicles WHERE usual_fuel_supplier_id IN (SELECT id FROM target_suppliers)) +
   (SELECT count(*) FROM fuel_supply_inputs WHERE supply_medium_id IN (SELECT id FROM target_media)) +
   (SELECT count(*) FROM fuel_equipment_loads WHERE supply_medium_id IN (SELECT id FROM target_media)) +
   (SELECT count(*) FROM fuel_tae_submissions WHERE supply_medium_id IN (SELECT id FROM target_media)) +
   (SELECT count(*) FROM fuel_anomaly_cases WHERE reference_entity_id IN (SELECT id FROM target_suppliers UNION ALL SELECT id FROM target_media UNION ALL SELECT id FROM target_runs)) +
   (SELECT count(*) FROM fuel_review_marks WHERE entity_id IN (SELECT id FROM target_suppliers UNION ALL SELECT id FROM target_media UNION ALL SELECT id FROM target_runs))
 )
) AS inventory`

export async function retireAramco(db: SqlExecutor, options: Options) {
  const [row] = await db.query(inventorySql)
  const inventory = row?.inventory as Inventory
  if (!inventory || typeof inventory.blockers !== "number") throw new Error("Inventario incompleto")
  const hash = createHash("sha256").update(JSON.stringify(inventory)).digest("hex")
  if (options.mode === "inventory") return { inventory, hash }
  if (inventory.blockers !== 0) throw new Error(`Existen ${inventory.blockers} dependencias que requieren tratamiento específico`)
  if (!options.actor.trim() || !options.backupRef.trim()) throw new Error("Se exige responsable y referencia de respaldo verificado")
  if (hash !== options.expectedHash) throw new Error("El inventario cambió; ejecutar inventario nuevamente")
  const [actor] = await db.query("SELECT id, email FROM users WHERE lower(email) = lower($1) AND is_active = true", [options.actor])
  if (!actor) throw new Error("Responsable no encontrado o inactivo")

  // A projected row needs a series rebuild and is rejected by the inventory.
  // In a mixed batch retain all other source rows and recompute its summary.
  await db.query(`${target}, removed AS (
    DELETE FROM fuel_operation_records WHERE id IN (SELECT id FROM target_operations) RETURNING batch_id
  ), affected AS (SELECT DISTINCT batch_id FROM removed), totals AS (
    SELECT a.batch_id, count(r.id)::integer AS valid_rows, count(DISTINCT r.plate)::integer AS equipment,
      coalesce(sum(r.liters), 0) AS liters, coalesce(sum(r.monto), 0) AS amount,
      min(r.fecha) AS from_date, max(r.fecha) AS to_date
    FROM affected a LEFT JOIN fuel_operation_records r ON r.batch_id = a.batch_id
      AND r.id NOT IN (SELECT id FROM target_operations)
    GROUP BY a.batch_id
  ) UPDATE fuel_operation_batches b SET filas_validas = totals.valid_rows,
      total_filas = totals.valid_rows + b.filas_invalidas, total_equipos = totals.equipment,
      total_litros = totals.liters, total_monto = totals.amount,
      periodo_desde = coalesce(totals.from_date, b.periodo_desde),
      periodo_hasta = coalesce(totals.to_date, b.periodo_hasta), updated_at = now(),
      estado = CASE WHEN totals.valid_rows = 0 THEN 'revertido' ELSE b.estado END
    FROM totals WHERE b.id = totals.batch_id`)
  await db.query(`${target} DELETE FROM fuel_supply_media WHERE id IN (SELECT id FROM target_media)`)
  await db.query(`${target} DELETE FROM fuel_suppliers WHERE id IN (SELECT id FROM target_suppliers)`)
  await db.query("DELETE FROM fuel_provider_sync_runs WHERE provider = 'aramco'")
  await db.query("DELETE FROM system_settings WHERE key LIKE 'combustibles.aramco.%'")
  await db.query("DELETE FROM cron_runs WHERE job_name = 'fuel-aramco-sync'")
  await db.query(`INSERT INTO audit_log (id,user_id,user_email,action,entity_type,entity_id,old_state,new_state,reason)
    VALUES ($1,$2,$3,'delete','fuel_provider_retirement','aramco',$4,$5,$6)`,
  [randomUUID(), actor.id, actor.email, JSON.stringify(inventory), JSON.stringify({ backupRef: options.backupRef, inventoryHash: hash }), "Retiro de integración Aramco y proveedor Esmax"])
  return { inventory, hash }
}
