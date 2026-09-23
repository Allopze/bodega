/**
 * lib/__tests__/prevention-surveillance-exempt-migration.test.ts
 *
 * La exención de un control de vigilancia pasa a exigir motivo en base (0324).
 *
 * Hasta ese cambio `recordSurveillanceOutcome` forzaba el motivo a NULL al
 * eximir, así que toda exención ya registrada en producción lo tiene vacío y el
 * CHECK nuevo, aplicado a secas, tumbaría el deploy. Lo que se protege acá es el
 * orden y el contenido del saneamiento: la 0323 marca esas exenciones con su
 * procedencia —sin inventarles un motivo—, la 0324 agrega el CHECK sobre datos
 * que ya lo cumplen, y ninguna otra fila se toca.
 */
import { PGlite } from "@electric-sql/pglite"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"

const pg = new PGlite()
const migrationsDir = path.resolve(process.cwd(), "db/migrations")
const LEGACY_MARKER = "Exención registrada antes de exigir motivo: no consta por qué se eximió."

async function backfillStatement(): Promise<string> {
  const migration = await readFile(path.join(migrationsDir, "0323_medical_shocker.sql"), "utf8")
  const start = migration.indexOf('UPDATE "prevention_surveillance_enrollments"')
  expect(start).toBeGreaterThanOrEqual(0)
  const end = migration.indexOf(";", start)
  expect(end).toBeGreaterThan(start)
  return migration.slice(start, end + 1)
}

afterAll(async () => {
  await pg.close()
})

describe("migración de la exención con motivo (0323 → 0324)", () => {
  it("marca las exenciones previas sin motivo y deja pasar el CHECK", async () => {
    // La tabla con la forma que tenía antes del cambio: el CHECK de la
    // ausencia ya existía, el de la exención no.
    await pg.exec(`
      CREATE TABLE prevention_surveillance_enrollments (
        id text PRIMARY KEY,
        status text NOT NULL,
        absence_reason text,
        CONSTRAINT prevention_surveillance_enrollment_absent_consistent
          CHECK (status <> 'absent' OR length(absence_reason) >= 5)
      );
      INSERT INTO prevention_surveillance_enrollments (id, status, absence_reason) VALUES
        ('exenta-sin-motivo', 'exempt', NULL),
        ('exenta-motivo-corto', 'exempt', 'Licencia'),
        ('exenta-con-motivo', 'exempt', 'Control vigente con la mutual del empleador anterior.'),
        ('ausente', 'absent', 'No vino'),
        ('pendiente', 'pending', NULL);
    `)

    // Sin el saneamiento, el CHECK de la 0324 no se puede agregar.
    const checkMigration = await readFile(path.join(migrationsDir, "0324_unique_echo.sql"), "utf8")
    await expect(pg.exec(checkMigration)).rejects.toThrow()

    await pg.exec(await backfillStatement())
    await expect(pg.exec(checkMigration)).resolves.toBeDefined()

    const rows = await pg.query<{ id: string; absence_reason: string | null }>(
      "SELECT id, absence_reason FROM prevention_surveillance_enrollments ORDER BY id",
    )
    expect(Object.fromEntries(rows.rows.map((row) => [row.id, row.absence_reason]))).toEqual({
      "ausente": "No vino",
      "exenta-con-motivo": "Control vigente con la mutual del empleador anterior.",
      "exenta-motivo-corto": LEGACY_MARKER,
      "exenta-sin-motivo": LEGACY_MARKER,
      "pendiente": null,
    })
  })

  it("el saneamiento es idempotente y el CHECK rechaza exenciones nuevas sin motivo", async () => {
    await pg.exec(await backfillStatement())
    const marked = await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM prevention_surveillance_enrollments WHERE absence_reason = '${LEGACY_MARKER}'`,
    )
    expect(marked.rows[0]!.n).toBe(2)

    await expect(pg.exec(
      "INSERT INTO prevention_surveillance_enrollments (id, status, absence_reason) VALUES ('nueva', 'exempt', 'corto')",
    )).rejects.toThrow()
  })
})
