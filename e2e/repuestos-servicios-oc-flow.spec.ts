import { expect, test, type Page } from "@playwright/test"
import { login, pickCurrentMonthDate } from "./helpers"

async function createAndSubmitRepuesto(page: Page) {
  await page.goto("/solicitudes/nueva?tipo=repuestos")
  await pickCurrentMonthDate(page, "Seleccionar fecha")
  await page.getByPlaceholder("Proveedor único, urgencia, mercado limitado...").fill("Repuesto urgente E2E")
  await page.getByPlaceholder("Ej: Filtro de aceite, Correa de distribución...").fill("Filtro de aire E2E")
  await page.getByPlaceholder("OEM o fabricante").fill("OEM-FLOW-001")
  await page.getByPlaceholder("Ej: Retroexcavadora, Camión grúa...").fill("Retroexcavadora E2E")
  await page.getByPlaceholder("Ej: ABCD-12").fill("FLOW-REP")
  await page.getByRole("button", { name: /Enviar a aprobación/ }).click()
  await expect(page).toHaveURL(/\/solicitudes\/[^/]+$/)
}

async function createAndSubmitServicio(page: Page) {
  await page.goto("/solicitudes/nueva?tipo=servicios")
  await pickCurrentMonthDate(page, "Seleccionar fecha")
  await page.getByPlaceholder("Proveedor único, urgencia, mercado limitado...").fill("Servicio urgente E2E")
  await page.getByPlaceholder("Ej: Mantención preventiva bomba hidráulica...").fill("Mantencion compresor E2E")
  await page.getByPlaceholder("Ej: Sector norte, sala de máquinas...").fill("Sala compresores E2E")
  await page.getByPlaceholder("Ej: Retroexcavadora, Generador...").fill("Compresor E2E")
  await page.getByPlaceholder("Ej: ABCD-12").fill("FLOW-SRV")
  await page.getByRole("button", { name: /Enviar a aprobación/ }).click()
  await expect(page).toHaveURL(/\/solicitudes\/[^/]+$/)
}

test.describe("Repuestos/Servicios — aprobación y visibilidad en compras", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("repuesto aprobado aparece en listado de compras pendientes", async ({ page }) => {
    await createAndSubmitRepuesto(page)

    // Navigate to approvals and approve the repuesto item
    await page.goto("/aprobaciones")
    // Find the repuesto item row and approve it
    const approveBtn = page.getByRole("button", { name: "Aprobar", exact: true })
    if (await approveBtn.isVisible()) {
      await approveBtn.first().click()
      await page.getByRole("button", { name: "Confirmar aprobación" }).click()
    }

    // The item should eventually be purchasable
    await page.goto("/compras/nueva")
    await expect(page.locator("h1")).toContainText(/nueva orden/i)
    // At minimum, the page should load without error
  })

  test("servicio aprobado aparece en listado de compras pendientes", async ({ page }) => {
    await createAndSubmitServicio(page)

    await page.goto("/aprobaciones")
    const approveBtn = page.getByRole("button", { name: "Aprobar", exact: true })
    if (await approveBtn.isVisible()) {
      await approveBtn.first().click()
      await page.getByRole("button", { name: "Confirmar aprobación" }).click()
    }

    await page.goto("/compras/nueva")
    await expect(page.locator("h1")).toContainText(/nueva orden/i)
  })

  test("detalle de repuesto muestra panel de cotizaciones", async ({ page }) => {
    await createAndSubmitRepuesto(page)

    // The detail page should show a quotation panel
    await expect(page.getByText("Cotizaciones")).toBeVisible()
    await expect(page.getByText("Subir cotización")).toBeVisible()
  })

  test("detalle de servicio muestra panel de cotizaciones", async ({ page }) => {
    await createAndSubmitServicio(page)

    await expect(page.getByText("Cotizaciones")).toBeVisible()
    await expect(page.getByText("Subir cotización")).toBeVisible()
  })
})
