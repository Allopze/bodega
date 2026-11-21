/**
 * Migración 0399 (Trinorma, preventiva declarada anterior a la plataforma, 2026-11-21): aditiva,
 * con las cuatro columnas juntas y el respaldo obligatorio, y reversible con
 * `docs/mantencion/trinorma/0399-reversion.sql`.
 */
import { PGlite } from "@electric-sql/pglite"
import { mkdtemp, readFile, readdir, symlink, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const MIGRATIONS = path.resolve(process.cwd(), "db/migrations")
const REVERSION = path.resolve(process.cwd(), "docs/mantencion/trinorma/0399-reversion.sql")

/** Catálogo comparable: columnas, restricciones e índices de `public`. */
async function catalog(pg: PGlite) {
  const columns = await pg.query<{ v: string }>(`
    select table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') as v
    from information_schema.columns where table_schema = 'public' order by 1`)
  const constraints = await pg.query<{ v: string }>(`
    select conrelid::regclass::text || '.' || conname || ':' || contype::text as v
    from pg_constraint where connamespace = 'public'::regnamespace order by 1`)
  const indexes = await pg.query<{ v: string }>(`
    select tablename || '.' || indexname || ':' || indexdef as v
    from pg_indexes where schemaname = 'public' order by 1`)
  return [...columns.rows, ...constraints.rows, ...indexes.rows].map((row) => row.v)
}

/** Cadena de migraciones hasta la 0399, incluida o no; las posteriores quedan fuera. */
async function chainAround0399(include: boolean): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), include ? "mig-0399-" : "mig-0398b-"))
  await mkdir(path.join(dir, "meta"))
  const journal = JSON.parse(await readFile(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] }
  const index = journal.entries.findIndex((entry) => entry.tag.startsWith("0399_"))
  expect(index).toBeGreaterThan(0)
  journal.entries = journal.entries.slice(0, include ? index + 1 : index)
  const kept = new Set(journal.entries.map((entry) => entry.tag))
  await writeFile(path.join(dir, "meta", "_journal.json"), JSON.stringify(journal))
  for (const file of await readdir(MIGRATIONS)) {
    if (file.endsWith(".sql") && kept.has(file.slice(0, -4))) await symlink(path.join(MIGRATIONS, file), path.join(dir, file))
  }
  return dir
}

// Con opciones explícitas el wrapper de Vitest no inyecta la plantilla migrada.
const full = new PGlite({})
const before = new PGlite({})

beforeAll(async () => {
  await migratePGlite(full, await chainAround0399(true))
  await migratePGlite(before, await chainAround0399(false))
  await full.exec(`
    insert into users (id, name, email, hashed_password) values ('u1', 'Jefatura', 'jefatura@chome.test', 'x');
    insert into worksites (id, code, name) values ('w1', 'W1', 'Faena');
    insert into fuel_equipment_types (id, slug, name, category, default_meter_type, default_performance_unit)
      values ('t1', 't1', 'Camión', 'truck', 'odometer', 'km_per_liter');
    insert into fuel_vehicles (id, code, plate, type, equipment_type_id, worksite_id) values ('v1', 'KA-1', 'AAAA11', 'Camión', 't1', 'w1');
    insert into mant_brands (id, name, name_key) values ('b1', 'Scania', 'scania');
    insert into mant_equipment_profiles (vehicle_id, brand_id) values ('v1', 'b1');
  `)
}, 240_000)

afterAll(async () => {
  await full.close()
  await before.close()
})

const set = (sql: string) => full.exec(`update mant_equipment_profiles set ${sql} where vehicle_id = 'v1'`)

describe.sequential("migración 0399", () => {
  it("parte vacía: un equipo existente no tiene preventiva declarada", async () => {
    const row = await full.query<{ d: string | null }>(`select prior_preventive_date as d from mant_equipment_profiles where vehicle_id = 'v1'`)
    expect(row.rows[0]?.d).toBeNull()
  })

  it("exige las cuatro juntas: fecha, lectura, servicio y respaldo", async () => {
    await expect(set(`prior_preventive_date = '2026-08-20'`)).rejects.toThrow(/prior_preventive_all/)
    await expect(set(`prior_preventive_date = '2026-08-20', prior_preventive_reading = 414394, prior_preventive_interval = 40000`)).rejects.toThrow(/prior_preventive_all/)
    await set(`prior_preventive_date = '2026-08-20', prior_preventive_reading = 414394, prior_preventive_interval = 40000, prior_preventive_evidence = 'OT 35513', prior_preventive_declared_by = 'u1', prior_preventive_source = 'Planilla'`)
  })

  it("rechaza un respaldo en blanco, una lectura negativa y un servicio cero", async () => {
    await expect(set(`prior_preventive_evidence = '   '`)).rejects.toThrow(/prior_preventive_valid/)
    await expect(set(`prior_preventive_reading = -1`)).rejects.toThrow(/prior_preventive_valid/)
    await expect(set(`prior_preventive_interval = 0`)).rejects.toThrow(/prior_preventive_valid/)
  })

  it("si se borra el usuario que la declaró, la declaración queda sin autor, no se pierde", async () => {
    await full.exec(`delete from users where id = 'u1'`)
    const row = await full.query<{ by: string | null; d: string | null }>(`select prior_preventive_declared_by as by, prior_preventive_date as d from mant_equipment_profiles where vehicle_id = 'v1'`)
    expect(row.rows[0]).toEqual({ by: null, d: "2026-08-20" })
  })

  it("la reversión deja el mismo catálogo que la cadena hasta la 0398", async () => {
    await full.exec(`delete from mant_equipment_profiles; delete from mant_brands; delete from fuel_vehicles; delete from fuel_equipment_types; delete from worksites;`)
    const sql = await readFile(REVERSION, "utf8")
    for (const statement of sql.split("--> statement-breakpoint")) {
      const body = statement.replace(/^\s*--.*$/gm, "").trim()
      if (body) await full.exec(body)
    }
    expect(await catalog(full)).toEqual(await catalog(before))
  })
})
