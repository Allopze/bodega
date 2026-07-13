import path from "node:path"
import { expect, test } from "@playwright/test"
import postgres from "postgres"
import { login } from "./helpers"

const workbookPath = path.resolve(process.cwd(), "CONTROL_MANUAL_COMBUSTIBLES_UNIFICADO.xlsx")

test.describe("TAE — importación histórica real", () => {
  test.beforeAll(async () => {
    const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
    if (!databaseUrl) throw new Error("E2E_DATABASE_URL es requerido")
    const sql = postgres(databaseUrl, { max: 1 })
    try {
      await sql`
        insert into worksites (id, name, code, is_active)
        values
          ('ws-tae-masisa', 'Masisa', 'TAE-MASISA', true),
          ('ws-tae-pacifico', 'Pacifico', 'TAE-PACIFICO', true),
          ('ws-tae-cholguan', 'Cholguan', 'TAE-CHOLGUAN', true),
          ('ws-tae-santa-fe', 'Santa Fe Gruas', 'TAE-SANTA-FE', true)
        on conflict (id) do nothing
      `
    } finally { await sql.end() }
  })

  test("importa 971 filas, conserva evidencias y bloquea el mismo archivo", async ({ page }) => {
    test.setTimeout(180_000)
    await login(page)
    await page.goto("/combustibles/tae/importar")
    await expect(page.getByRole("heading", { name: "Importar histórico TAE" })).toBeVisible()

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(workbookPath)
    await page.getByRole("button", { name: "Generar reporte" }).click()
    await expect(page.getByText("Revisé el reporte de mapeo")).toBeVisible({ timeout: 90_000 })
    await page.getByRole("checkbox").check()
    await page.getByRole("button", { name: "Importar histórico definitivamente" }).click()
    await expect(page.getByText("Importación completada")).toBeVisible({ timeout: 120_000 })
    await expect(page.getByText(/971 filas/)).toBeVisible()

    const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
    const sql = postgres(databaseUrl!, { max: 1 })
    try {
      const [counts] = await sql<{ batches: number; submissions: number; evidence: number; invalid: number }[]>`
        select
          (select count(*)::int from fuel_tae_import_batches where status = 'imported') as batches,
          (select count(*)::int from fuel_tae_submissions where source = 'legacy_xlsx') as submissions,
          (select count(*)::int from fuel_tae_evidence) as evidence,
          (select coalesce(sum(invalid_rows), 0)::int from fuel_tae_import_batches where status = 'imported') as invalid
      `
      if (!counts) throw new Error("No se obtuvieron los conteos de la importación TAE")
      expect(counts.batches).toBe(1)
      expect(counts.submissions).toBe(971)
      expect(counts.evidence).toBeGreaterThanOrEqual(3_880)
      expect(counts.invalid).toBe(1)

      await fileInput.setInputFiles([])
      await fileInput.setInputFiles(workbookPath)
      await page.getByRole("button", { name: "Generar reporte" }).click()
      await expect(page.getByText("Revisé el reporte de mapeo")).toBeVisible({ timeout: 90_000 })
      await page.getByRole("checkbox").check()
      await page.getByRole("button", { name: "Importar histórico definitivamente" }).click()
      await expect(page.getByText(/Este archivo ya fue importado/)).toBeVisible({ timeout: 90_000 })

      const [after] = await sql<{ batches: number; submissions: number }[]>`
        select
          (select count(*)::int from fuel_tae_import_batches where status = 'imported') as batches,
          (select count(*)::int from fuel_tae_submissions where source = 'legacy_xlsx') as submissions
      `
      if (!after) throw new Error("No se obtuvieron los conteos posteriores de la importación TAE")
      expect(after).toEqual({ batches: 1, submissions: 971 })
    } finally { await sql.end() }
  })
})
