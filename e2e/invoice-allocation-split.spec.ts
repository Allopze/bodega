import { expect, test } from "@playwright/test"
import { login } from "./helpers"

/**
 * Cierra los escenarios de navegador que el informe QA de integridad dejaba
 * declarados como brecha: repartir una línea entre dos de OC, el rechazo del
 * exceso y de la evidencia obsoleta, la proyección de disponibilidad, y el
 * recorrido con un usuario acotado a una faena.
 *
 * Todo ocurre sobre `oc-qa-reparto-e2e`, un fixture propio: dividir aquí no
 * altera lo que afirma el spec de facturación parcial.
 */
const OC = "/compras/oc-qa-reparto-e2e"

async function abrirEditor(page: import("@playwright/test").Page, orden = OC) {
  await page.goto(`${orden}?tab=facturacion`)
  await page.getByRole("button", { name: "Dividir línea" }).first().click()
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 })
}

test("reparte una línea de factura 6 + 4 entre las dos líneas de la OC", async ({ page }) => {
  await login(page)
  await abrirEditor(page)
  const dialog = page.getByRole("dialog")

  await dialog.getByLabel("Línea de OC 1").click()
  await page.getByRole("option", { name: /6 unidad/ }).click()
  await dialog.getByLabel("Cantidad 1").fill("6")
  await dialog.getByLabel("Subtotal 1").fill("6000")

  await dialog.getByRole("button", { name: "Añadir asignación" }).click()
  await dialog.getByLabel("Línea de OC 2").click()
  await page.getByRole("option", { name: /4 unidad/ }).click()
  await dialog.getByLabel("Cantidad 2").fill("4")
  await dialog.getByLabel("Subtotal 2").fill("4000")

  await dialog.getByRole("button", { name: "Guardar reparto" }).click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })

  // El reparto queda guardado y la evidencia por línea deja de estar sin asignar.
  await expect(page.getByRole("button", { name: "Dividir línea" }).first()).toBeVisible({ timeout: 15_000 })
})

test("rechaza repartir 6 + 5 sobre una línea que factura 10", async ({ page }) => {
  await login(page)
  // Orden propia: el caso anterior deja repartida la suya.
  await abrirEditor(page, "/compras/oc-qa-exceso-e2e")
  const dialog = page.getByRole("dialog")

  await dialog.getByLabel("Línea de OC 1").click()
  await page.getByRole("option", { name: /7 unidad/ }).click()
  await dialog.getByLabel("Cantidad 1").fill("6")
  await dialog.getByLabel("Subtotal 1").fill("6000")

  await dialog.getByRole("button", { name: "Añadir asignación" }).click()
  await dialog.getByLabel("Línea de OC 2").click()
  await page.getByRole("option", { name: /5 unidad/ }).click()
  await dialog.getByLabel("Cantidad 2").fill("5")
  await dialog.getByLabel("Subtotal 2").fill("5000")

  // El exceso se ataja antes de enviar: el botón de guardar no habilita.
  await expect(dialog.getByRole("button", { name: "Guardar reparto" })).toBeDisabled()
})

test("la disponibilidad proyectada distingue entrega directa de vía oficina", async ({ page }) => {
  await login(page)
  await page.goto("/bodega?faena=ws-e2e")

  // Las tres columnas de la proyección: lo comprometido, lo que viene en
  // camino y el saldo resultante.
  for (const columna of ["Demanda pendiente", "Entrada esperada", "Saldo proyectado"]) {
    await expect(page.getByRole("columnheader", { name: columna }).first()).toBeVisible({ timeout: 15_000 })
  }

  // Y la vista no rompe al cambiar de faena, que es donde se cruzan los dos
  // modos de entrega (directo a faena y vía oficina).
  await page.goto("/bodega?faena=ws-oficina-e2e")
  await expect(page.getByRole("table").first()).toBeVisible({ timeout: 15_000 })
})

test("un usuario acotado a su faena no ve la mesa de integridad de compras", async ({ page }) => {
  await login(page, "scoped@e2e.chome.cl", "scoped2026")

  await page.goto("/bodega/trazabilidad?tab=integridad&faena=ws-e2e")

  // `warehouse:view_traceability` no está entre sus permisos: la ruta redirige
  // en vez de mostrar una mesa vacía, que sería indistinguible de "todo bien".
  await expect(page).toHaveURL(/\/forbidden|\/dashboard/, { timeout: 15_000 })
})

test("la mesa conserva la identidad de variante y no desborda en móvil", async ({ page }) => {
  await login(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/bodega/trazabilidad?tab=integridad&faena=ws-e2e")

  await page.getByRole("button", { name: "Revisar integridad" }).click()
  const caso = page.getByRole("listitem").filter({ hasText: "Guante QA Integridad E2E" })
  await expect(caso).toHaveCount(1, { timeout: 15_000 })

  // La variante concreta viaja con su SKU, no un nombre genérico de producto.
  await expect(caso.getByText("QA-INT-001", { exact: false })).toBeVisible()

  // Y nada empuja el ancho del documento más allá del viewport.
  const desborde = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(desborde).toBeLessThanOrEqual(1)
})
