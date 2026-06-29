import { expect, test } from "@playwright/test"
import { login, pickCurrentMonthDate } from "./helpers"

test("repuestos: crea borrador y envia solicitud a aprobacion", async ({ page }) => {
  await login(page)
  await page.goto("/repuestos/nueva")

  await expect(page.getByRole("heading", { name: "Nueva solicitud de repuestos" })).toBeVisible()
  await pickCurrentMonthDate(page, "Seleccionar fecha")
  await page.getByPlaceholder("Proveedor único, urgencia, mercado limitado...").fill("Proveedor unico para repuesto E2E")
  await page.getByPlaceholder("Ej: Filtro de aceite, Correa de distribución...").fill("Filtro hidraulico E2E")
  await page.getByPlaceholder("OEM o fabricante").fill("OEM-E2E-001")
  await page.getByPlaceholder("Ej: Retroexcavadora, Camión grúa...").fill("Excavadora E2E")
  await page.getByPlaceholder("Ej: ABCD-12").fill("REP-E2E")

  await page.getByRole("button", { name: /Guardar borrador/ }).click()
  await expect(page.locator("#main-content").getByText("Borrador guardado")).toBeVisible()

  await page.getByRole("button", { name: /Enviar a aprobación/ }).click()
  await expect(page).toHaveURL(/\/repuestos\/[^/]+$/)
  await expect(page.getByRole("heading", { name: /Solicitud/ })).toBeVisible()
  await expect(page.getByText("Filtro hidraulico E2E", { exact: true })).toBeVisible()
})

test("servicios: crea borrador y envia solicitud a aprobacion", async ({ page }) => {
  await login(page)
  await page.goto("/servicios/nueva")

  await expect(page.getByRole("heading", { name: "Nueva solicitud de servicios" })).toBeVisible()
  await pickCurrentMonthDate(page, "Seleccionar fecha")
  await page.getByPlaceholder("Proveedor único, urgencia, mercado limitado...").fill("Proveedor unico para servicio E2E")
  await page.getByPlaceholder("Ej: Mantención preventiva bomba hidráulica...").fill("Mantencion generador E2E")
  await page.getByPlaceholder("Ej: Sector norte, sala de máquinas...").fill("Sala de maquinas E2E")
  await page.getByPlaceholder("Ej: Retroexcavadora, Generador...").fill("Generador E2E")
  await page.getByPlaceholder("Ej: ABCD-12").fill("SER-E2E")

  await page.getByRole("button", { name: /Guardar borrador/ }).click()
  await expect(page.locator("#main-content").getByText("Borrador guardado")).toBeVisible()

  await page.getByRole("button", { name: /Enviar a aprobación/ }).click()
  await expect(page).toHaveURL(/\/servicios\/[^/]+$/)
  await expect(page.getByRole("heading", { name: /Solicitud/ })).toBeVisible()
  await expect(page.getByText("Mantencion generador E2E", { exact: true })).toBeVisible()
})
