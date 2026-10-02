/**
 * lib/__tests__/worker-sex-catalog-migration.test.ts
 *
 * El sexo registral pasa a hombre / mujer / otro (0349). Las dos columnas que
 * comparten el catálogo ya tienen datos con los valores retirados, así que el
 * CHECK nuevo, aplicado a secas, tumbaría el deploy. Lo que se protege acá es
 * la conversión: `intersex` pasa a `other`, `unspecified` («No informa») queda
 * sin registrar en vez de inventarle un sexo, y el resto no se toca.
 */
import { PGlite } from "@electric-sql/pglite"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { PERSON_SEX_VALUES } from "@/lib/person-sex"

const pg = new PGlite()
const migration = readFile(path.resolve(process.cwd(), "db/migrations/0349_worker_sex_otro.sql"), "utf8")

const OLD_VALUES = "('female', 'male', 'intersex', 'unspecified')"

afterAll(async () => {
  await pg.close()
})

describe("migración del catálogo de sexo (0349)", () => {
  it("convierte los valores retirados y deja puesto el CHECK nuevo", async () => {
    // Las dos tablas con la forma que tenían antes (0071 y 0343).
    await pg.exec(`
      CREATE TABLE workers (
        id text PRIMARY KEY,
        sex text,
        CONSTRAINT workers_sex_valid CHECK (sex IS NULL OR sex IN ${OLD_VALUES})
      );
      CREATE TABLE prevention_incident_people (
        id text PRIMARY KEY,
        sex text,
        CONSTRAINT prevention_incident_person_sex_valid CHECK (sex IS NULL OR sex IN ${OLD_VALUES})
      );
    `)
    for (const table of ["workers", "prevention_incident_people"]) {
      await pg.exec(`
        INSERT INTO ${table} (id, sex) VALUES
          ('hombre', 'male'), ('mujer', 'female'), ('intersex', 'intersex'),
          ('no-informa', 'unspecified'), ('sin-registrar', NULL);
      `)
    }

    await pg.exec(await migration)

    for (const table of ["workers", "prevention_incident_people"]) {
      const rows = await pg.query<{ id: string; sex: string | null }>(`SELECT id, sex FROM ${table} ORDER BY id`)
      expect(Object.fromEntries(rows.rows.map((row) => [row.id, row.sex])), table).toEqual({
        "hombre": "male",
        "intersex": "other",
        "mujer": "female",
        "no-informa": null,
        "sin-registrar": null,
      })
      await expect(pg.exec(`INSERT INTO ${table} (id, sex) VALUES ('nuevo-otro', 'other')`)).resolves.toBeDefined()
      for (const retired of ["intersex", "unspecified"]) {
        await expect(pg.exec(`INSERT INTO ${table} (id, sex) VALUES ('retirado', '${retired}')`), `${table}: ${retired}`).rejects.toThrow()
      }
    }
  })

  it("el CHECK de la base y el catálogo de la aplicación son los mismos valores", async () => {
    const sql = await migration
    const expected = `IN (${PERSON_SEX_VALUES.map((value) => `'${value}'`).join(", ")})`
    expect(sql.match(new RegExp(expected.replace(/[()]/g, "\\$&"), "g"))).toHaveLength(2)
  })
})
