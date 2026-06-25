import { test, expect } from "@playwright/test"

test.describe("Combustibles module", () => {
  test.beforeEach(async ({ page }) => {
    // Login as admin
    await page.goto("/login")
    await page.fill('input[name="email"]', "admin@chome.cl")
    await page.fill('input[name="password"]', "chome2026")
    await page.click('button[type="submit"]')
    await page.waitForURL("/dashboard")
  })

  test("dashboard loads with KPIs and charts", async ({ page }) => {
    await page.goto("/combustibles")
    await expect(page.locator("h1")).toContainText("Combustibles")
    // KPI cards should be visible
    await expect(page.getByText("Litros totales")).toBeVisible()
    await expect(page.getByText("Total gastado")).toBeVisible()
    await expect(page.getByText("Cargas")).toBeVisible()
  })

  test("create a new fuel load", async ({ page }) => {
    await page.goto("/combustibles/nueva")
    await expect(page.locator("h1")).toContainText("Nueva carga")

    // Fill form
    await page.fill('input[name="loadDate"]', "2026-06-15")
    await page.selectOption('select[name="serviceType"]', "TCT")
    // Select first vehicle, supplier, worksite from dropdowns
    const vehicleSelect = page.locator('select[name="vehicleId"]')
    if (await vehicleSelect.isVisible()) {
      const options = await vehicleSelect.locator("option").all()
      if (options.length > 1) await vehicleSelect.selectOption({ index: 1 })
    }
    const supplierSelect = page.locator('select[name="fuelSupplierId"]')
    if (await supplierSelect.isVisible()) {
      const options = await supplierSelect.locator("option").all()
      if (options.length > 1) await supplierSelect.selectOption({ index: 1 })
    }
    const worksiteSelect = page.locator('select[name="worksiteId"]')
    if (await worksiteSelect.isVisible()) {
      const options = await worksiteSelect.locator("option").all()
      if (options.length > 1) await worksiteSelect.selectOption({ index: 1 })
    }
    await page.selectOption('select[name="product"]', "PETROLEO DIESEL")
    await page.fill('input[name="receiptNumber"]', "TEST-001")
    await page.fill('input[name="liters"]', "1000")
    await page.fill('input[name="baseAmount"]', "1000000")

    // Submit
    await page.click('button[type="submit"]:has-text("Registrar")')
    // Should redirect to dashboard
    await page.waitForURL("/combustibles", { timeout: 10000 })
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
    await expect(page.getByText("Semanal")).toBeVisible()
    await expect(page.getByText("Mensual")).toBeVisible()
  })

  test("import page loads with wizard", async ({ page }) => {
    await page.goto("/combustibles/importar")
    await expect(page.locator("h1")).toContainText("Importar")
    await expect(page.getByText("Subir archivo")).toBeVisible()
    await expect(page.getByText("Revisar datos")).toBeVisible()
    await expect(page.getByText("Completado")).toBeVisible()
  })
})
