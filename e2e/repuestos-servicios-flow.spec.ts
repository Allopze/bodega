import { expect, test } from "@playwright/test"
import { login, pickCurrentMonthDate, selectRadixById } from "./helpers"

test("repuestos: crea borrador y envia solicitud a aprobacion", async ({ page }) => {
  await login(page)
  await page.goto("/solicitudes/nueva")

  await expect(page.getByRole("heading", { name: "Nueva solicitud de compra" })).toBeVisible()
  await selectRadixById(page, "worksiteId", "Faena E2E")
  await selectRadixById(page, "requestType", "Repuestos")
  await pickCurrentMonthDate(page, "Seleccionar fecha")

  // Quotation-type item fields rendered by the unified ItemEditor
  await page.getByPlaceholder("Describe el ítem requerido...").fill("Filtro hidraulico E2E")
  await page.getByPlaceholder("OEM o fabricante").fill("OEM-E2E-001")
  await page.getByPlaceholder("Ej: Retroexcavadora, Camión grúa...").fill("Excavadora E2E")
  await page.getByPlaceholder("Ej: ABCD-12").fill("REP-E2E")

  await page.getByRole("button", { name: /Guardar borrador/ }).click()
  await expect(page.getByText("Borrador guardado")).toBeVisible()

  await page.getByRole("button", { name: /Enviar a aprobación/ }).click()
  await expect(page).toHaveURL(/\/solicitudes\/(?!nueva$)[^/]+$/, { timeout: 15_000 })
  await expect(page.getByRole("heading", { name: /Solicitud/ })).toBeVisible()
  await expect(page.getByText("Filtro hidraulico E2E").first()).toBeVisible()
})

test("servicios: crea borrador y envia solicitud a aprobacion", async ({ page }) => {
  await login(page)
  await page.goto("/solicitudes/nueva")

  await expect(page.getByRole("heading", { name: "Nueva solicitud de compra" })).toBeVisible()
  await selectRadixById(page, "worksiteId", "Faena E2E")
  await selectRadixById(page, "requestType", "Servicios")
  await pickCurrentMonthDate(page, "Seleccionar fecha")

  await page.getByPlaceholder("Describe el ítem requerido...").fill("Mantencion generador E2E")
  await page.getByPlaceholder("Ej: Sector norte, sala de máquinas...").fill("Sala de maquinas E2E")
  await page.getByPlaceholder("Ej: Retroexcavadora, Generador...").fill("Generador E2E")
  await page.getByPlaceholder("Ej: ABCD-12").fill("SER-E2E")

  await page.getByRole("button", { name: /Guardar borrador/ }).click()
  await expect(page.getByText("Borrador guardado")).toBeVisible()

  await page.getByRole("button", { name: /Enviar a aprobación/ }).click()
  await expect(page).toHaveURL(/\/solicitudes\/(?!nueva$)[^/]+$/, { timeout: 15_000 })
  await expect(page.getByRole("heading", { name: /Solicitud/ })).toBeVisible()
  await expect(page.getByText("Mantencion generador E2E").first()).toBeVisible()
})
