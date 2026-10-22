import { createHash } from "node:crypto"
import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
import postgres from "postgres"
import { blobStorageWorks } from "./helpers"

const accessToken = "tae-e2e-access-token"
const photoPath = path.resolve(process.cwd(), "public/tae-icon-512.png")

/** Recorre los seis pasos del formulario de terreno y deja la carga lista en «Revisar y enviar». */
async function fillTaeForm(page: Page, liters: string) {
  const next = page.getByRole("button", { name: "Siguiente" })
  // Paso 1 · Equipo. El producto único y el medio sugerido por el lugar («TAE») quedan elegidos solos.
  await expect(page.getByText("Paso 1 de 6")).toBeVisible()
  await page.getByRole("option", { name: /E2E-FUEL-1/ }).click()
  const diesel = page.getByRole("radio", { name: /Di[eé]sel/i })
  if (await diesel.count()) await diesel.first().click()
  await next.click()
  // Paso 2 · Medidor: lectura digitada (si el equipo tiene medidor) y foto.
  await expect(page.getByText("Paso 2 de 6")).toBeVisible()
  const reading = page.locator("#tae-meter-reading")
  // Monótona entre corridas (una lectura menor que la anterior se rechaza) y
  // bajo el tope de 9.999.999: minutos transcurridos desde 2026.
  if (await reading.count()) await reading.fill(String(Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 60_000)))
  await page.locator("#tae-evidence-odometer").setInputFiles(photoPath)
  await expect(page.getByText("Repetir foto")).toHaveCount(1, { timeout: 30_000 })
  await next.click()
  // Paso 3 · Litros
  await expect(page.getByText("Paso 3 de 6")).toBeVisible()
  await page.locator("#tae-liters").fill(liters)
  await page.locator("#tae-evidence-liter_meter").setInputFiles(photoPath)
  await expect(page.getByText("Repetir foto")).toHaveCount(1, { timeout: 30_000 })
  await next.click()
  // Paso 4 · Sellos (número + foto de cada uno)
  await expect(page.getByText("Paso 4 de 6")).toBeVisible()
  await page.locator("#tae-removed").fill("SELLO-ANTERIOR")
  await page.locator("#tae-evidence-removed_seal").setInputFiles(photoPath)
  await page.locator("#tae-installed").fill(`SELLO-${liters}`)
  await page.locator("#tae-evidence-installed_seal").setInputFiles(photoPath)
  await expect(page.getByText("Repetir foto")).toHaveCount(2, { timeout: 30_000 })
  await next.click()
  // Paso 5 · Personas (sin RUT verificado se escribe el nombre)
  await expect(page.getByText("Paso 5 de 6")).toBeVisible()
  await page.locator("#tae-driver").fill("Conductor E2E")
  await page.locator("#tae-supervisor").fill("Supervisor E2E")
  await next.click()
  // Paso 6 · Revisar y enviar
  await expect(page.getByText("Paso 6 de 6")).toBeVisible()
  await expect(page.getByText(`SELLO-${liters}`)).toBeVisible()
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
    await page.getByRole("button", { name: "Enviar carga" }).click()
    await expect(page).toHaveURL(/\/tae\/resultado\//, { timeout: 45_000 })
    await expect(page.getByRole("heading", { name: "Carga registrada" })).toBeVisible()
    await page.getByRole("link", { name: "Registrar otra carga con el acceso guardado" }).click()
    await expect(page).toHaveURL(/\/tae$/, { timeout: 20_000 })
    await expect(page.getByRole("heading", { name: "Carga TAE" })).toBeVisible()
    await fillTaeForm(page, "102.5")
    await context.setOffline(true)
    // La cola guarda las cuatro fotos como `Blob`. En el WebKit que Playwright
    // instala aquí, `setOffline(true)` deja los `Blob` ilegibles —incluso uno
    // creado en memoria— así que el encolado no puede completarse y el fallo no
    // mediría la aplicación. Ver `blobStorageWorks`.
    test.skip(!await blobStorageWorks(page), "Con la red simulada apagada este navegador no puede releer un Blob: el escenario no mide la aplicación.")
    await page.getByRole("button", { name: "Enviar carga" }).click()
    await expect(page.getByText(/1 pendiente/)).toBeVisible({ timeout: 15_000 })
    await context.setOffline(false)

    const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
    const sql = postgres(databaseUrl!, { max: 1 })
    try {
      await expect.poll(async () => {
        // Acotado al punto de carga de esta prueba: contar toda la tabla hacía
        // que cualquier otra spec que registrara una carga TAE rompiera este
        // aserto, que pasaba en aislamiento y fallaba en la suite completa.
        const [row] = await sql<[{ submissions: number; evidence: number }][]>`
          select
            (select count(*)::int from fuel_tae_submissions
               where source = 'public_pwa' and loading_point_id = 'tae-point-e2e') as submissions,
            (select count(*)::int from fuel_tae_evidence e
               inner join fuel_tae_submissions s on s.id = e.submission_id
               where s.source = 'public_pwa' and s.loading_point_id = 'tae-point-e2e') as evidence
        `
        return row
      }, { timeout: 45_000 }).toEqual({ submissions: 2, evidence: 8 })
      await expect(page.getByText(/1 pendiente/)).not.toBeVisible({ timeout: 20_000 })
    } finally { await sql.end() }
  })
})
