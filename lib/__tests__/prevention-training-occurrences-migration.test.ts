import { PGlite } from "@electric-sql/pglite"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"

const pg = new PGlite()
const migrationPath = path.resolve(process.cwd(), "db/migrations/0291_training_occurrences_simplification.sql")

async function occurrenceSeedStatement(): Promise<string> {
  const migration = await readFile(migrationPath, "utf8")
  const start = migration.indexOf('INSERT INTO "prevention_training_occurrences"')
  expect(start).toBeGreaterThanOrEqual(0)
  const end = migration.indexOf(";", start)
  expect(end).toBeGreaterThan(start)
  return migration.slice(start, end + 1)
}

afterAll(async () => {
  await pg.close()
})

describe("migración de ocurrencias de capacitación", () => {
  it("materializa las posiciones del cronograma para las faenas activas", async () => {
    await pg.exec(`
      CREATE TABLE prevention_training_catalog_items (
        id text PRIMARY KEY,
        code text NOT NULL,
        catalog_version text NOT NULL,
        schedule_json jsonb NOT NULL,
        is_active boolean NOT NULL
      );
      CREATE TABLE worksites (
        id text PRIMARY KEY,
        is_active boolean NOT NULL
      );
      CREATE TABLE prevention_training_occurrences (
        id text PRIMARY KEY,
        catalog_item_id text NOT NULL,
        worksite_id text NOT NULL,
        year integer NOT NULL,
        slot_key text NOT NULL,
        scheduled_month integer,
        scheduled_week integer,
        status text NOT NULL,
        version integer NOT NULL
      );
      CREATE UNIQUE INDEX prevention_training_occurrence_slot_unique
        ON prevention_training_occurrences (catalog_item_id, worksite_id, year, slot_key);
      INSERT INTO prevention_training_catalog_items
        (id, code, catalog_version, schedule_json, is_active)
      VALUES
        ('training-catalog-2026-cam-01', 'CAM-01', 'programa-capacitacion-2026-v1',
         '[{"slotKey":"m03-w2","month":3,"week":2}]'::jsonb, true);
      INSERT INTO worksites (id, is_active) VALUES
        ('faena-activa', true),
        ('faena-inactiva', false);
    `)

    await expect(pg.exec(await occurrenceSeedStatement())).resolves.toBeDefined()

    const result = await pg.query<{
      id: string
      catalog_item_id: string
      worksite_id: string
      year: number
      slot_key: string
      scheduled_month: number
      scheduled_week: number
      status: string
      version: number
    }>(`
      SELECT id, catalog_item_id, worksite_id, year, slot_key,
             scheduled_month, scheduled_week, status, version
      FROM prevention_training_occurrences
    `)

    expect(result.rows).toEqual([{
      id: "training-occurrence-2026-faena-activa-cam-01-m03-w2",
      catalog_item_id: "training-catalog-2026-cam-01",
      worksite_id: "faena-activa",
      year: 2026,
      slot_key: "m03-w2",
      scheduled_month: 3,
      scheduled_week: 2,
      status: "pending",
      version: 1,
    }])
  })
})
