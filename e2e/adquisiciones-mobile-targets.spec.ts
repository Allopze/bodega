import { expect, test, type Locator, type Page } from "@playwright/test"
import { login } from "./helpers"

async function expectMobileTarget(page: Page, target: Locator, name: string) {
  await expect(target).toBeVisible()
  const box = await target.boundingBox()
  expect(box, `${name} no tiene caja visible`).not.toBeNull()
  expect(box?.width, `${name} debe medir al menos 44 px de ancho en móvil`).toBeGreaterThanOrEqual(44)
  expect(box?.height, `${name} debe medir al menos 44 px de alto en móvil`).toBeGreaterThanOrEqual(44)
}

test("Adquisiciones conserva objetivos táctiles de 44 px en acciones secundarias", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page)

  await page.goto("/compras/oc-e2e?tab=facturacion")
  await expectMobileTarget(
    page,
    page.getByLabel("Eliminar factura FAC-E2E-0001"),
    "Eliminar factura",
  )

  await page.goto("/entregas")
  await expectMobileTarget(
    page,
    page.locator("article").filter({ hasText: "ENT-2026-0001" }).getByLabel("Comprobante de entrega ENT-2026-0001"),
    "Comprobante de entrega",
  )

  await page.goto("/recepcion/rec-sin-factura-e2e")
  await expectMobileTarget(
    page,
    page.getByRole("link", { name: "Adjuntar factura" }),
    "Adjuntar factura desde recepción",
  )
})
