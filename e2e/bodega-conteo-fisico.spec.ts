import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * Cubre lo que el nombre del archivo prometía: el archivo anterior sólo
 * verificaba que la página cargara, así que ajuste, conteo, borrador y baja
 * nunca se ejercitaron de punta a punta.
 */
test.describe("Bodega — vistas, filtros y movimientos", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("las vistas son enlaces y cada una trae sus propias consultas", async ({ page }) => {
    await page.goto("/bodega")
    await expect(page.getByRole("heading", { name: "Bodega" })).toBeVisible()
    await expect(page.getByRole("heading", { name: /Stock por/ })).toBeVisible()

    // Las pestañas son <Link>: navegan sin esperar hidratación.
    await page.getByRole("link", { name: /^Kardex/ }).click()
    await expect(page.getByRole("heading", { name: "Kardex" })).toBeVisible()
    expect(new URL(page.url()).searchParams.get("vista")).toBe("kardex")

    await page.getByLabel("Vistas de bodega").getByRole("link", { name: "Documentos" }).click()
    await expect(page.getByRole("heading", { name: "Documentos de bodega" })).toBeVisible()
  })

  test("la búsqueda del kardex consulta el servidor, no sólo la página cargada", async ({ page }) => {
    await page.goto("/bodega?vista=kardex")

    const search = page.getByRole("searchbox", { name: "Buscar en bodega" })
    // `toBeEnabled` pasa con el HTML del servidor, antes de que React hidrate:
    // un `fill` en esa ventana escribe en el DOM sin que exista el `onChange`,
    // así que el debounce nunca arranca y la URL no cambia. Se reintenta hasta
    // que la navegación ocurra de verdad.
    await expect(search).toBeEnabled()
    await expect(async () => {
      await search.fill("zzz-no-existe-zzz")
      await expect(page).toHaveURL(/[?&]q=zzz-no-existe-zzz/, { timeout: 3_000 })
    }).toPass({ timeout: 30_000 })
    await expect(page.getByText("Sin coincidencias en el kardex")).toBeVisible({ timeout: 15_000 })
    // Sin filas no queda un paginador huérfano flotando bajo la tabla ausente.
    await expect(page.getByRole("navigation", { name: /paginaci/i })).toHaveCount(0)
  })

  test("registra un ajuste con folio y lo deja consultable en Documentos", async ({ page }) => {
    await page.goto("/bodega")
    await page.getByRole("button", { name: "Registrar movimiento" }).click()

    await page.getByRole("button", { name: /Ajuste de inventario/ }).click()
    await page.getByRole("combobox", { name: "Faena", exact: true }).click()
    await page.getByRole("option").first().click()

    // Las opciones llegan del endpoint por faena, no del render de la página.
    const productTrigger = page.locator("#adjustProductId")
    await expect(productTrigger).toBeVisible()
    await productTrigger.click()
    await page.getByRole("option").first().click()

    // El saldo actual queda a la vista antes de corregirlo.
    await expect(page.getByText(/Stock actual:/)).toBeVisible()

    await page.getByLabel("Dirección").click()
    await page.getByRole("option", { name: /aumentar/ }).click()
    await page.getByLabel("Cantidad").fill("2")
    await page.locator("#adjustReason").fill("Ajuste e2e")
    await page.getByRole("button", { name: "Registrar ajuste" }).click()

    await expect(page.getByText(/Ajuste AJU-\d{4}-\d{4} registrado/)).toBeVisible({ timeout: 15_000 })

    await page.goto("/bodega/documentos")
    await expect(page.getByText("Ajuste e2e").first()).toBeVisible()
    await expect(page.getByText(/AJU-\d{4}-\d{4}/).first()).toBeVisible()
  })

  test("guarda un conteo como borrador, lo retoma y lo cierra con su folio", async ({ page }) => {
    await page.goto("/bodega")
    await page.getByRole("button", { name: "Registrar movimiento" }).click()
    await page.getByRole("button", { name: /Conteo físico/ }).click()
    await page.getByRole("combobox", { name: "Faena", exact: true }).click()
    await page.getByRole("option").first().click()

    const search = page.getByRole("searchbox", { name: "Buscar producto en el conteo" })
    await expect(search).toBeEnabled()

    const firstQty = page.locator('input[name="countedQuantity"]').first()
    await expect(firstQty).toBeVisible()
    await firstQty.fill("7")
    await page.getByRole("button", { name: "Guardar borrador" }).click()
    await expect(page.getByText(/Borrador CON-\d{4}-\d{4} guardado/)).toBeVisible({ timeout: 15_000 })

    // Reabrir: el conteo se retoma donde quedó en vez de empezar de nuevo.
    await page.reload()
    await page.getByRole("button", { name: "Registrar movimiento" }).click()
    await page.getByRole("button", { name: /Conteo físico/ }).click()
    await page.getByRole("combobox", { name: "Faena", exact: true }).click()
    await page.getByRole("option").first().click()
    await expect(page.getByText(/Retomando el borrador CON-\d{4}-\d{4}/)).toBeVisible({ timeout: 15_000 })

    await page.getByRole("button", { name: "Cerrar conteo" }).click()
    await expect(page.getByText(/Conteo CON-\d{4}-\d{4} cerrado/)).toBeVisible({ timeout: 15_000 })
  })

  test("da de baja existencias con folio DES propio", async ({ page }) => {
    await page.goto("/bodega")
    await page.getByRole("button", { name: "Registrar movimiento" }).click()
    await page.getByRole("button", { name: /Baja por desecho/ }).click()
    await page.getByRole("combobox", { name: "Faena", exact: true }).click()
    await page.getByRole("option").first().click()

    const productTrigger = page.locator("#discardProductId")
    await expect(productTrigger).toBeVisible()
    await productTrigger.click()
    await page.getByRole("option").first().click()

    await page.getByLabel("Cantidad a dar de baja").fill("1")
    await page.locator("#discardReason").fill("Dañado en e2e")
    await page.getByRole("button", { name: "Registrar baja" }).click()

    await expect(page.getByText(/Baja DES-\d{4}-\d{4} registrada/)).toBeVisible({ timeout: 15_000 })

    await page.goto("/bodega?vista=kardex")
    await expect(page.getByText("Baja").first()).toBeVisible()
  })

  test("define stock mínimo para toda una faena de una vez", async ({ page }) => {
    await page.goto("/bodega")
    await page.getByRole("button", { name: "Registrar movimiento" }).click()
    await page.getByRole("button", { name: /Definir stock mínimo/ }).click()
    await page.getByRole("combobox", { name: "Faena", exact: true }).click()
    await page.getByRole("option").first().click()

    const firstMin = page.locator('input[name="minStockValue"]').first()
    await expect(firstMin).toBeVisible({ timeout: 15_000 })
    await firstMin.fill("3")
    await page.getByRole("button", { name: "Guardar mínimos" }).click()

    await expect(page.getByText(/mínimo actualizado|mínimos actualizados|Sin cambios/)).toBeVisible({ timeout: 15_000 })
  })

  test("las guías de despacho tienen entrada en el menú", async ({ page }) => {
    await page.goto("/bodega")

    const guides = page.getByRole("link", { name: "Guías de despacho" })
    await expect(guides.first()).toBeVisible()
    await guides.first().click()
    await expect(page.getByRole("heading", { name: /guías internas/i })).toBeVisible()
  })
})
