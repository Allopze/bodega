import { expect, test, type Page } from "@playwright/test"

test("entregas: registra EPP recibido a trabajador", async ({ page }) => {
  await login(page)

  await page.goto("/entregas")
  await expect(page.getByRole("heading", { name: "Entregas", exact: true })).toBeVisible()

  await selectRadixById(page, "deliveryWorkerId", /Trabajador E2E/)
  await selectRadixById(page, "deliveryRequestItemId", /Casco EPP E2E/)
  await page.getByLabel(/^Cantidad/).fill("2")
  await page.getByLabel("Recibido por").fill("Supervisor E2E")
  await page.getByRole("button", { name: "Registrar entrega" }).click()

  await expect(page.getByRole("row", { name: /Trabajador E2E.*Casco EPP E2E.*2 unidad.*Supervisor E2E/ })).toBeVisible({
    timeout: 30_000,
  })
})

async function login(page: Page) {
  await page.goto("/login")
  await page.getByLabel("Correo electrónico").fill("admin@e2e.chome.cl")
  await page.getByLabel("Contraseña").fill("chome2026")
  await page.getByRole("button", { name: "Ingresar" }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

async function selectRadixById(page: Page, id: string, option: string | RegExp) {
  await page.locator(`#${id}`).click()
  await page.getByRole("option", { name: option }).click()
}
