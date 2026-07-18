import { createHash } from "node:crypto"
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
import postgres from "postgres"
import { selectRadixById } from "./helpers"

const accessToken = "tae-e2e-access-token"
const photoPath = path.resolve(process.cwd(), "public/tae-icon-512.png")

async function fillTaeForm(page: Page, liters: string) {
  await page.locator("#tae-driver").fill("Conductor E2E")
  await page.locator("#tae-supervisor").fill("Supervisor E2E")
  await selectRadixById(page, "tae-vehicle", /E2E-FUEL-1/)
  await selectRadixById(page, "tae-product", /Di[eé]sel/i)
  await page.locator("#tae-liters").fill(liters)
  await page.locator("#tae-removed").fill("SELLO-ANTERIOR")
  await page.locator("#tae-installed").fill(`SELLO-${liters}`)
  for (const kind of ["odometer", "liter_meter", "removed_seal", "installed_seal"]) {
    await page.locator(`#tae-evidence-${kind}`).setInputFiles(photoPath)
  }
  await expect(page.getByText("Repetir foto")).toHaveCount(4, { timeout: 30_000 })
}

test.describe("TAE — flujo público completo", () => {
  test.beforeAll(async () => {
    const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
    if (!databaseUrl) throw new Error("E2E_DATABASE_URL es requerido")
    const sql = postgres(databaseUrl, { max: 1 })
    try {
      await sql`
        insert into fuel_tae_loading_points (id, worksite_id, name, type, is_active)
        values ('tae-point-e2e', 'ws-e2e', 'Surtidor TAE E2E', 'tae', true)
        on conflict (id) do nothing
      `
      await sql`
        insert into fuel_tae_public_links (id, worksite_id, loading_point_id, label, token_hash, created_by)
        values ('tae-link-e2e', 'ws-e2e', 'tae-point-e2e', 'Acceso E2E', ${createHash("sha256").update(accessToken).digest("hex")}, 'user-admin-e2e')
        on conflict (id) do nothing
      `
    } finally { await sql.end() }
  })

  test("activa QR, envía online y sincroniza una segunda carga offline", async ({ page, context }) => {
    test.setTimeout(120_000)
    await page.goto(`/tae/access/${accessToken}`)
    await expect(page).toHaveURL(/\/tae$/, { timeout: 20_000 })
    await expect(page.getByRole("heading", { name: "Carga TAE" })).toBeVisible()

    await fillTaeForm(page, "101.5")
    await page.getByRole("button", { name: "Registrar carga TAE" }).click()
    await expect(page).toHaveURL(/\/tae\/resultado\//, { timeout: 45_000 })
    await expect(page.getByRole("heading", { name: "Carga registrada" })).toBeVisible()

    await page.goto("/tae")
    await fillTaeForm(page, "102.5")
    await context.setOffline(true)
    await page.getByRole("button", { name: "Registrar carga TAE" }).click()
    await expect(page.getByText(/1 pendiente/)).toBeVisible({ timeout: 15_000 })
    await context.setOffline(false)

    const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
    const sql = postgres(databaseUrl!, { max: 1 })
    try {
      await expect.poll(async () => {
        const [row] = await sql<[{ submissions: number; evidence: number }][]>`
          select
            (select count(*)::int from fuel_tae_submissions where source = 'public_pwa') as submissions,
            (select count(*)::int from fuel_tae_evidence e inner join fuel_tae_submissions s on s.id = e.submission_id where s.source = 'public_pwa') as evidence
        `
        return row
      }, { timeout: 45_000 }).toEqual({ submissions: 2, evidence: 8 })
      await expect(page.getByText(/1 pendiente/)).not.toBeVisible({ timeout: 20_000 })
    } finally { await sql.end() }
  })
})
