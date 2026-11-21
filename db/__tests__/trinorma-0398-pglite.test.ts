/**
 * Migración 0398 (Trinorma, 2026-11-21): aditiva, con el índice único de código
 * normalizado, y reversible con `docs/mantencion/trinorma/0398-reversion.sql`.
 */
import { PGlite } from "@electric-sql/pglite"
import { mkdtemp, readFile, readdir, symlink, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const MIGRATIONS = path.resolve(process.cwd(), "db/migrations")
const REVERSION = path.resolve(process.cwd(), "docs/mantencion/trinorma/0398-reversion.sql")

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

/** Carpeta temporal con la cadena hasta la 0397 (sin la 0398). */
async function chainUntil0397(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mig-0397-"))
  await mkdir(path.join(dir, "meta"))
  const journal = JSON.parse(await readFile(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] }
  const last = journal.entries.at(-1)!
  expect(last.tag.startsWith("0398_")).toBe(true)
  journal.entries = journal.entries.slice(0, -1)
  await writeFile(path.join(dir, "meta", "_journal.json"), JSON.stringify(journal))
  for (const file of await readdir(MIGRATIONS)) {
    if (file.endsWith(".sql") && !file.startsWith("0398_")) await symlink(path.join(MIGRATIONS, file), path.join(dir, file))
  }
  return dir
}

const full = new PGlite()
// Con opciones explícitas el wrapper de Vitest no inyecta la plantilla migrada
// (que ya trae la 0398): esta base parte vacía y recibe sólo hasta la 0397.
const before = new PGlite({})

beforeAll(async () => {
  await migratePGlite(full, MIGRATIONS)
  await migratePGlite(before, await chainUntil0397())
}, 240_000)

afterAll(async () => {
  await full.close()
  await before.close()
})

describe.sequential("migración 0398", () => {
  it("rechaza un código repetido tras normalizar y acepta códigos vacíos repetidos", async () => {
    await full.exec(`
      insert into worksites (id, name, code) values ('w1', 'Faena', 'W1');
      insert into fuel_equipment_types (id, slug, name, category, default_meter_type, default_performance_unit)
        values ('t1', 't1', 'Camión', 'truck', 'odometer', 'km_per_liter');
      insert into fuel_vehicles (id, code, plate, type, equipment_type_id, worksite_id) values
        ('v1', 'KRR-10', 'AAAA11', 'Camión', 't1', 'w1'),
        ('v2', null, 'BBBB22', 'Camión', 't1', 'w1'),
        ('v3', '', 'CCCC33', 'Camión', 't1', 'w1'),
        ('v4', null, 'DDDD44', 'Camión', 't1', 'w1');
    `)
    await expect(full.exec(`insert into fuel_vehicles (id, code, plate, type, equipment_type_id, worksite_id) values ('v5', 'krr 010', 'EEEE55', 'Camión', 't1', 'w1')`))
      .rejects.toThrow(/fuel_vehicles_code_key_unique/)
    await expect(full.exec(`insert into fuel_vehicles (id, code, plate, type, equipment_type_id, worksite_id) values ('v6', 'KRR-100', 'FFFF66', 'Camión', 't1', 'w1')`))
      .resolves.toBeDefined()
  })

  it("parte con los valores por defecto que no cambian nada existente", async () => {
    const site = await full.query<{ kind: string }>(`select kind from worksites where id = 'w1'`)
    expect(site.rows[0]?.kind).toBe("operacion")
    const vehicle = await full.query<{ owner_id: string | null; location_pending_confirmation: boolean }>(`select owner_id, location_pending_confirmation from fuel_vehicles where id = 'v1'`)
    expect(vehicle.rows[0]).toEqual({ owner_id: null, location_pending_confirmation: false })
  })

  it("la reversión deja el mismo catálogo que la cadena hasta la 0397", async () => {
    await full.exec(`delete from fuel_vehicles; delete from fuel_equipment_types; delete from worksites;`)
    const sql = await readFile(REVERSION, "utf8")
    for (const statement of sql.split("--> statement-breakpoint")) {
      const body = statement.replace(/^\s*--.*$/gm, "").trim()
      if (body) await full.exec(body)
    }
    expect(await catalog(full)).toEqual(await catalog(before))
  })
})
