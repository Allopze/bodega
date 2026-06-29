import { test, expect, type Page } from "@playwright/test"
import { login } from "./helpers"

async function selectCombobox(page: Page, index: number, option: string | RegExp) {
  await page.getByRole("combobox").nth(index).click()
  await page.getByRole("option", { name: option }).first().click()
}

test.describe("Combustibles module", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("dashboard loads with KPIs and charts", async ({ page }) => {
    await page.goto("/combustibles")
    await expect(page.locator("h1")).toContainText("Combustibles")
    // KPI cards should be visible
    await expect(page.getByText("Litros totales")).toBeVisible()
    await expect(page.getByText("Total gastado")).toBeVisible()
    await expect(page.getByText("Cargas", { exact: true }).first()).toBeVisible()
  })

  test("create a new fuel load", async ({ page }) => {
    await page.goto("/combustibles/nueva")
    await expect(page.locator("h1")).toContainText("Nueva carga")

    // Fill form
    await page.fill('input[name="loadDate"]', "2026-06-15")
    await selectCombobox(page, 0, "TCT")
    await selectCombobox(page, 1, /E2E-FUEL-1/)
    await selectCombobox(page, 2, "Proveedor Combustible E2E")
    await selectCombobox(page, 3, "Faena E2E")
    await selectCombobox(page, 4, "Petróleo Diésel")
    await page.fill('input[name="receiptNumber"]', "TEST-001")
    await page.fill('input[name="liters"]', "1000")
    await page.fill('input[name="baseAmount"]', "1000000")

    // Submit
    await page.getByRole("button", { name: "Registrar carga" }).click()
    await expect(page).toHaveURL(/\/combustibles$/, { timeout: 15_000 })
  })

  test("vehicles catalog page loads", async ({ page }) => {
    await page.goto("/combustibles/vehiculos")
    await expect(page.locator("h1")).toContainText("Vehículos")
    await expect(page.getByText("Patente")).toBeVisible()
  })

  test("suppliers catalog page loads", async ({ page }) => {
    await page.goto("/combustibles/proveedores-combustible")
    await expect(page.locator("h1")).toContainText("Proveedores")
    await expect(page.getByText("Nombre")).toBeVisible()
  })

  test("monthly statements page loads", async ({ page }) => {
    await page.goto("/combustibles/cuenta-corriente")
    await expect(page.locator("h1")).toContainText("Cuenta corriente")
  })

  test("reports page loads with tabs", async ({ page }) => {
    await page.goto("/combustibles/reportes")
    await expect(page.locator("h1")).toContainText("Reportes")
    await expect(page.getByRole("tab", { name: "Semanal" })).toBeVisible()
    await expect(page.getByRole("tab", { name: "Mensual" })).toBeVisible()
  })

  test("import modal opens from dashboard", async ({ page }) => {
    await page.goto("/combustibles")
    await page.getByRole("button", { name: "Importar Excel" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText("Importar cargas desde Excel")).toBeVisible()
    await expect(dialog.getByText("Subir archivo")).toBeVisible()
    await expect(dialog.getByText("Revisar datos")).toBeVisible()
    await expect(dialog.getByText("Completado")).toBeVisible()
  })
})
