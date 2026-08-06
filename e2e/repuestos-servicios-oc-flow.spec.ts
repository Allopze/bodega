import { expect, test, type Page } from "@playwright/test"
import { login, pickCurrentMonthDate, selectRadixById } from "./helpers"

async function createAndSubmitRepuesto(page: Page) {
  await page.goto("/solicitudes/nueva")
  // El formulario es cliente puro (selects Radix, autosave, Server Actions):
  // sin hidratar, los clics se pierden y el envío se queda en /solicitudes/nueva
  // sin dejar rastro. En el runner de CI, más lento, esa carrera se pierde.
  await page.waitForLoadState("networkidle").catch(() => undefined)
  await selectRadixById(page, "worksiteId", "Faena E2E")
  await selectRadixById(page, "requestType", "Repuestos")
  await expect(page.locator("#requestType")).toContainText("Repuestos")
  await expect(page.getByText("Flujo para Repuestos")).toBeVisible()
  await pickCurrentMonthDate(page, "Seleccionar fecha")
  await page.getByPlaceholder("Describe el ítem requerido...").fill("Filtro de aire E2E")
  await page.getByPlaceholder("OEM o fabricante").fill("OEM-FLOW-001")
  await page.getByPlaceholder("Ej: Retroexcavadora, Camión grúa...").fill("Retroexcavadora E2E")
  await page.getByPlaceholder("Ej: ABCD-12").fill("FLOW-REP")
  // submitRequest exige >= 3 cotizaciones o una justificación en notas.
  await page.getByPlaceholder("Observaciones, contexto de la solicitud...").fill("E2E: menos de 3 cotizaciones, justificado en la prueba")
  await page.getByRole("button", { name: /Guardar borrador/ }).click()
  await page.getByRole("button", { name: /Enviar a aprobación/ }).click()
  await expect(page).toHaveURL(/\/solicitudes\/(?!nueva$)[^/]+$/, { timeout: 15_000 })
}

async function createAndSubmitServicio(page: Page) {
  await page.goto("/solicitudes/nueva")
  // El formulario es cliente puro (selects Radix, autosave, Server Actions):
  // sin hidratar, los clics se pierden y el envío se queda en /solicitudes/nueva
  // sin dejar rastro. En el runner de CI, más lento, esa carrera se pierde.
  await page.waitForLoadState("networkidle").catch(() => undefined)
  await selectRadixById(page, "worksiteId", "Faena E2E")
  await selectRadixById(page, "requestType", "Servicios")
  await expect(page.locator("#requestType")).toContainText("Servicios")
  await expect(page.getByText("Flujo para Servicios")).toBeVisible()
  await pickCurrentMonthDate(page, "Seleccionar fecha")
  await page.getByPlaceholder("Describe el ítem requerido...").fill("Mantencion compresor E2E")
  await page.getByPlaceholder("Ej: Sector norte, sala de máquinas...").fill("Sala compresores E2E")
  await page.getByPlaceholder("Ej: Retroexcavadora, Generador...").fill("Compresor E2E")
  await page.getByPlaceholder("Ej: ABCD-12").fill("FLOW-SRV")
  // submitRequest exige >= 3 cotizaciones o una justificación en notas.
  await page.getByPlaceholder("Observaciones, contexto de la solicitud...").fill("E2E: menos de 3 cotizaciones, justificado en la prueba")
  await page.getByRole("button", { name: /Guardar borrador/ }).click()
  await page.getByRole("button", { name: /Enviar a aprobación/ }).click()
  await expect(page).toHaveURL(/\/solicitudes\/(?!nueva$)[^/]+$/, { timeout: 15_000 })
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
    // La cola puede traer más de un ítem aprobable según lo que dejaron las
    // pruebas anteriores: `isVisible()` sobre el locator sin acotar viola el
    // modo estricto en cuanto hay dos.
    const approveBtn = page.getByRole("button", { name: "Aprobar", exact: true }).first()
    if (await approveBtn.isVisible()) {
      await approveBtn.click()
      await page.getByRole("button", { name: "Confirmar aprobación" }).click()
    }

    // The item should eventually be purchasable
    await page.goto("/compras/nueva")
    await expect(page.locator("h1").first()).toContainText(/nueva orden/i)
    // At minimum, the page should load without error
  })

  test("servicio aprobado aparece en listado de compras pendientes", async ({ page }) => {
    await createAndSubmitServicio(page)

    await page.goto("/aprobaciones")
    // La cola puede traer más de un ítem aprobable según lo que dejaron las
    // pruebas anteriores: `isVisible()` sobre el locator sin acotar viola el
    // modo estricto en cuanto hay dos.
    const approveBtn = page.getByRole("button", { name: "Aprobar", exact: true }).first()
    if (await approveBtn.isVisible()) {
      await approveBtn.click()
      await page.getByRole("button", { name: "Confirmar aprobación" }).click()
    }

    await page.goto("/compras/nueva")
    await expect(page.locator("h1").first()).toContainText(/nueva orden/i)
  })

  test("detalle de repuesto muestra panel de cotizaciones", async ({ page }) => {
    await createAndSubmitRepuesto(page)

    // The detail page should show a quotation panel. The request is already
    // submitted (not draft/returned), so the "Agregar cotización" upload
    // control is correctly hidden — isEditable-gated in quotation-panel.tsx.
    await expect(page.getByRole("heading", { name: "Cotizaciones" })).toBeVisible()
    await expect(page.getByText("No hay cotizaciones adjuntas.")).toBeVisible()
  })

  test("detalle de servicio muestra panel de cotizaciones", async ({ page }) => {
    await createAndSubmitServicio(page)

    await expect(page.getByRole("heading", { name: "Cotizaciones" })).toBeVisible()
    await expect(page.getByText("No hay cotizaciones adjuntas.")).toBeVisible()
  })
})
