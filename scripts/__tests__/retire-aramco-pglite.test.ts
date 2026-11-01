import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { migratePGlite } from "../../lib/testing/pglite-migrate"
import { retireAramco, type SqlExecutor } from "../retire-aramco-core"

const pg = new PGlite()
const db: SqlExecutor = { query: async (sql, params = []) => (await pg.query(sql, params)).rows as Record<string, unknown>[] }
const actor = "operator@example.test"
const backupRef = "prueba-respaldo-verificado"

beforeAll(async () => {
  await migratePGlite(pg, "db/migrations")
  // Restore the old constraint to exercise an already-deployed pre-0367 database.
  await pg.exec(`
    ALTER TABLE fuel_provider_sync_runs DROP CONSTRAINT fuel_provider_sync_runs_provider_valid;
    ALTER TABLE fuel_provider_sync_runs ADD CONSTRAINT fuel_provider_sync_runs_provider_valid CHECK (provider IN ('copec','aramco'));
    INSERT INTO users (id,name,email,hashed_password) VALUES ('operator','Operador','operator@example.test','test');
    INSERT INTO fuel_suppliers (id,name,rut) VALUES ('fs-esmax','Esmax Distribución SpA','79588870-5');
    INSERT INTO fuel_supply_media (id,slug,name,kind,provider_code,aliases,sort_order)
      VALUES ('fsm-aramco','aramco','Aramco','card','aramco','[]'::jsonb,40);
    INSERT INTO fuel_provider_sync_runs (id,provider,trigger,requested_from,requested_to,status,correlation_id)
      VALUES ('aramco-run','aramco','manual','2026-01-01','2026-01-31','success','aramco-correlation'),
             ('copec-run','copec','manual','2026-01-01','2026-01-31','success','copec-correlation');
    INSERT INTO system_settings (key,value) VALUES ('combustibles.aramco.sync_enabled','false');
    INSERT INTO dte_documents (id,tipo_dte,folio,rut_emisor,razon_social_emisor,fecha_emision,monto_total,cod_emp,periodo,raw_hash)
      VALUES ('dte-esmax','33',123,'79588870-5','Esmax Distribución SpA','2026-01-01',1000,'1','2026-01','hash-dte');
    INSERT INTO fuel_operation_batches (id,archivo_nombre,hash_archivo,periodo_desde,periodo_hasta,importado_por,total_filas,filas_validas,total_equipos,total_litros,total_monto)
      VALUES ('mixed','mixed.xlsx','hash','2026-01-01','2026-01-31','operator',2,2,2,5,30),
             ('solo-esmax','solo.xlsx','hash-solo','2026-01-01','2026-01-01','operator',1,1,1,1,5);
    INSERT INTO fuel_operation_records (id,batch_id,plate,fecha,liters,monto,proveedor_nombre,fuel_supplier_id)
      VALUES ('operation-esmax','mixed','TEST-01','2026-01-01',2,10,'Esmax','fs-esmax'),
             ('operation-copec','mixed','TEST-02','2026-01-15',3,20,'Copec',NULL),
             ('operation-solo','solo-esmax','TEST-04','2026-01-01',1,5,'Esmax','fs-esmax');
  `)
}, 120_000)
afterAll(async () => { await pg.close() })

describe("retiro de Aramco sobre esquema real", () => {
  it("depura solo Esmax en lotes mixtos, audita y conserva DTE y Copec", async () => {
    await pg.exec("INSERT INTO fuel_operation_records (id,batch_id,plate,fecha,liters,proveedor_nombre) VALUES ('unresolved','mixed','TEST-03','2026-01-01',1,'Esmax')")
    const blocked = await retireAramco(db, { mode: "inventory" })
    expect(blocked.inventory.blockers).toBeGreaterThan(0)
    await expect(pg.transaction(async tx => {
      const txdb: SqlExecutor = { query: async (sql, params = []) => (await tx.query(sql, params)).rows as Record<string, unknown>[] }
      return retireAramco(txdb, { mode: "apply", actor, backupRef, expectedHash: blocked.hash })
    })).rejects.toThrow(/dependencias/)
    expect((await pg.query("SELECT id FROM fuel_operation_records ORDER BY id")).rows).toHaveLength(4)
    await pg.exec("DELETE FROM fuel_operation_records WHERE id = 'unresolved'")
    await pg.exec("INSERT INTO fuel_suppliers (id,name,rut) VALUES ('homonym','Estación Esmax independiente','12345678-9')")
    const homonym = await retireAramco(db, { mode: "inventory" })
    expect(homonym.inventory.blockers).toBeGreaterThan(0)
    await expect(pg.transaction(async tx => {
      const txdb: SqlExecutor = { query: async (sql, params = []) => (await tx.query(sql, params)).rows as Record<string, unknown>[] }
      return retireAramco(txdb, { mode: "apply", actor, backupRef, expectedHash: homonym.hash })
    })).rejects.toThrow(/dependencias/)
    expect((await pg.query("SELECT id FROM fuel_suppliers WHERE id='homonym'")).rows).toHaveLength(1)
    await pg.exec("DELETE FROM fuel_suppliers WHERE id='homonym'")
    await pg.exec(`INSERT INTO fuel_supply_media (id,slug,name,kind,provider_code,fuel_supplier_id,aliases,sort_order)
      VALUES ('fsm-copec-esmax','copec-esmax','Medio Copec','card','copec','fs-esmax','[]'::jsonb,41)`)
    const mixedMedium = await retireAramco(db, { mode: "inventory" })
    expect(mixedMedium.inventory.blockers).toBeGreaterThan(0)
    await expect(pg.transaction(async tx => {
      const txdb: SqlExecutor = { query: async (sql, params = []) => (await tx.query(sql, params)).rows as Record<string, unknown>[] }
      return retireAramco(txdb, { mode: "apply", actor, backupRef, expectedHash: mixedMedium.hash })
    })).rejects.toThrow(/dependencias/)
    expect((await pg.query("SELECT provider_code FROM fuel_supply_media WHERE id='fsm-copec-esmax'")).rows).toEqual([{ provider_code: "copec" }])
    await pg.exec("DELETE FROM fuel_supply_media WHERE id='fsm-copec-esmax'")
    await pg.exec("UPDATE fuel_suppliers SET rut='12345678-9' WHERE id='fs-esmax'")
    const wrongRut = await retireAramco(db, { mode: "inventory" })
    expect(wrongRut.inventory.blockers).toBeGreaterThan(0)
    await expect(pg.transaction(async tx => {
      const txdb: SqlExecutor = { query: async (sql, params = []) => (await tx.query(sql, params)).rows as Record<string, unknown>[] }
      return retireAramco(txdb, { mode: "apply", actor, backupRef, expectedHash: wrongRut.hash })
    })).rejects.toThrow(/dependencias/)
    expect((await pg.query("SELECT rut FROM fuel_suppliers WHERE id='fs-esmax'")).rows).toEqual([{ rut: "12345678-9" }])
    await pg.exec("UPDATE fuel_suppliers SET rut='79588870-5' WHERE id='fs-esmax'")
    await pg.exec("INSERT INTO fuel_review_marks (id,entity_type,entity_id,marked_by) VALUES ('review','operation','operation-esmax','operator')")
    const reviewed = await retireAramco(db, { mode: "inventory" })
    expect(reviewed.inventory.blockers).toBeGreaterThan(0)
    await expect(pg.transaction(async tx => {
      const txdb: SqlExecutor = { query: async (sql, params = []) => (await tx.query(sql, params)).rows as Record<string, unknown>[] }
      return retireAramco(txdb, { mode: "apply", actor, backupRef, expectedHash: reviewed.hash })
    })).rejects.toThrow(/dependencias/)
    expect((await pg.query("SELECT id FROM fuel_review_marks WHERE id='review'")).rows).toHaveLength(1)
    await pg.exec("DELETE FROM fuel_review_marks WHERE id='review'")
    await pg.exec(`INSERT INTO worksites (id,name,code) VALUES ('site','Faena','SITE');
      INSERT INTO fuel_equipment_loads (id,source,operation_record_id,worksite_id,occurred_at,month,liters)
        VALUES ('projection','operations_import','operation-esmax','site','2026-01-01','2026-01',2);`)
    const projected = await retireAramco(db, { mode: "inventory" })
    expect(projected.inventory.blockers).toBeGreaterThan(0)
    await expect(pg.transaction(async tx => {
      const txdb: SqlExecutor = { query: async (sql, params = []) => (await tx.query(sql, params)).rows as Record<string, unknown>[] }
      return retireAramco(txdb, { mode: "apply", actor, backupRef, expectedHash: projected.hash })
    })).rejects.toThrow(/dependencias/)
    expect((await pg.query("SELECT id FROM fuel_equipment_loads WHERE id='projection'")).rows).toHaveLength(1)
    await pg.exec("DELETE FROM fuel_equipment_loads WHERE id='projection'")
    const stale = await retireAramco(db, { mode: "inventory" })
    await pg.exec("UPDATE fuel_operation_records SET liters=4 WHERE id='operation-copec'")
    await expect(pg.transaction(async tx => {
      const txdb: SqlExecutor = { query: async (sql, params = []) => (await tx.query(sql, params)).rows as Record<string, unknown>[] }
      return retireAramco(txdb, { mode: "apply", actor, backupRef, expectedHash: stale.hash })
    })).rejects.toThrow(/inventario cambió/)
    await pg.exec("UPDATE fuel_operation_records SET liters=3 WHERE id='operation-copec'")
    const clean = await retireAramco(db, { mode: "inventory" })
    expect(clean.inventory.blockers).toBe(0)
    await pg.exec(`CREATE FUNCTION fail_retirement_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.entity_id = 'aramco' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_retirement_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_retirement_audit();`)
    await expect(pg.transaction(async tx => {
      const txdb: SqlExecutor = { query: async (sql, params = []) => (await tx.query(sql, params)).rows as Record<string, unknown>[] }
      return retireAramco(txdb, { mode: "apply", actor, backupRef, expectedHash: clean.hash })
    })).rejects.toThrow(/audit unavailable/)
    expect((await pg.query("SELECT id FROM fuel_suppliers WHERE id='fs-esmax'")).rows).toHaveLength(1)
    expect((await pg.query("SELECT id FROM fuel_supply_media WHERE id='fsm-aramco'")).rows).toHaveLength(1)
    expect((await pg.query("SELECT id FROM fuel_provider_sync_runs WHERE id='aramco-run'")).rows).toHaveLength(1)
    expect((await pg.query("SELECT id FROM fuel_operation_records WHERE id='operation-esmax'")).rows).toHaveLength(1)
    expect((await pg.query("SELECT total_filas FROM fuel_operation_batches WHERE id='mixed'")).rows).toEqual([{total_filas:2}])
    expect((await pg.query("SELECT key FROM system_settings WHERE key='combustibles.aramco.sync_enabled'")).rows).toHaveLength(1)
    await pg.exec("DROP TRIGGER fail_retirement_audit ON audit_log; DROP FUNCTION fail_retirement_audit()")
    await pg.transaction(async tx => {
      const txdb: SqlExecutor = { query: async (sql, params = []) => (await tx.query(sql, params)).rows as Record<string, unknown>[] }
      await retireAramco(txdb, { mode: "apply", actor, backupRef, expectedHash: clean.hash })
    })
    expect((await pg.query("SELECT id FROM dte_documents WHERE id='dte-esmax'")).rows).toHaveLength(1)
    expect((await pg.query("SELECT id FROM fuel_provider_sync_runs WHERE id='copec-run'")).rows).toHaveLength(1)
    expect((await pg.query("SELECT id FROM fuel_operation_records WHERE id='operation-copec'")).rows).toHaveLength(1)
    expect((await pg.query("SELECT id FROM fuel_operation_records WHERE id='operation-esmax'")).rows).toHaveLength(0)
    expect((await pg.query("SELECT total_filas,filas_validas,total_equipos,total_litros::float,total_monto::float,periodo_desde,periodo_hasta FROM fuel_operation_batches WHERE id='mixed'")).rows).toEqual([{total_filas:1,filas_validas:1,total_equipos:1,total_litros:3,total_monto:20,periodo_desde:'2026-01-15',periodo_hasta:'2026-01-15'}])
    expect((await pg.query("SELECT estado,filas_validas FROM fuel_operation_batches WHERE id='solo-esmax'")).rows).toEqual([{estado:'revertido',filas_validas:0}])
    expect((await pg.query("SELECT old_state::json->'emptied_batch_ids' AS ids FROM audit_log WHERE entity_type='fuel_provider_retirement' AND entity_id='aramco'")).rows).toEqual([{ids:['solo-esmax']}])
    expect((await pg.query("SELECT id FROM fuel_suppliers WHERE id='fs-esmax'")).rows).toHaveLength(0)
    expect((await pg.query("SELECT user_id FROM audit_log WHERE entity_type='fuel_provider_retirement' AND entity_id='aramco'")).rows).toEqual([{ user_id: "operator" }])
  }, 30_000)
})
