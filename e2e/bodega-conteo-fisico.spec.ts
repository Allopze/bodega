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
    // "Kardex" se llama Movimientos en pantalla; el valor de la URL no cambió.
    await page.getByLabel("Vistas de bodega").getByRole("link", { name: /^Movimientos/ }).click()
    await expect(page.getByRole("heading", { name: "Movimientos", exact: true })).toBeVisible()
    expect(new URL(page.url()).searchParams.get("vista")).toBe("kardex")

    await page.getByLabel("Vistas de bodega").getByRole("link", { name: "Documentos" }).click()
    await expect(page).toHaveURL(/\/bodega\/documentos/)
    // Documentos conserva las pestañas de Bodega para poder volver a Stock.
    const tabs = page.getByLabel("Vistas de bodega")
    await expect(tabs.getByRole("link", { name: "Documentos" })).toHaveAttribute("aria-current", "page")
    await expect(tabs.getByRole("link", { name: "Stock" })).toBeVisible()
  })

  test("avisa lo pendiente o dice en una línea que no hay nada, sin cuatro ceros", async ({ page }) => {
    await page.goto("/bodega")

    const strip = page.getByRole("navigation", { name: "Pendientes de bodega" })
    const quiet = page.getByText("Nada pendiente en bodega")
    await expect(strip.or(quiet)).toBeVisible({ timeout: 15_000 })
    // Un aviso en 0 no se muestra: cada enlace del aviso trae al menos una unidad.
    if (await strip.isVisible()) {
      expect(await strip.getByRole("link").count()).toBeLessThanOrEqual(4)
      await expect(strip.getByRole("link", { name: /^0\s/ })).toHaveCount(0)
    }
  })

  test("Movimientos lleva el período en Más filtros y el KPI de 30 días enlaza a esa ventana", async ({ page }) => {
    await page.goto("/bodega?vista=kardex")

    await expect(page.getByRole("button", { name: /Más filtros/ })).toBeVisible()
    // El rango de fechas ya no está a la vista: son 4 filtros primarios (A2).
    await expect(page.getByRole("button", { name: "Movimientos desde" })).toHaveCount(0)

    const kpi = page.getByRole("link", { name: /Movimientos · 30 d/ })
    await expect(kpi).toHaveAttribute("href", /vista=kardex.*desde=\d{4}-\d{2}-\d{2}/)
  })

  test("la hoja ordena los trabajos del bodeguero y ya no ofrece devolución a stock", async ({ page }) => {
    await page.goto("/bodega")
    await page.getByRole("button", { name: "Registrar movimiento" }).click()

    const dialog = page.getByRole("dialog")
    await expect(dialog.getByRole("button", { name: /^Baja o merma/ })).toBeVisible()
    await expect(dialog.getByRole("button", { name: /^Ajuste/ })).toBeVisible()
    await expect(dialog.getByRole("button", { name: /^Conteo físico/ })).toBeVisible()
    await expect(dialog.getByText("Devolución a stock")).toHaveCount(0)
    // Entregar lleva a la pantalla de entregas con la faena ya elegida.
    await expect(dialog.getByRole("link", { name: /^Entregar a trabajador/ })).toHaveAttribute("href", /\/entregas\?.*nueva=1/)
  })

  test("el menú de una fila de Stock abre el ajuste con su producto ya elegido", async ({ page }) => {
    await page.goto("/bodega")

    const menu = page.getByRole("button", { name: /^Acciones para / }).first()
    await expect(menu).toBeVisible({ timeout: 15_000 })
    await menu.click()
    await page.getByRole("menuitem", { name: "Ajustar" }).click()

    // Producto y faena vienen de la fila: el saldo se ve sin elegir nada.
    await expect(page.getByRole("dialog").getByText(/Stock actual/)).toBeVisible({ timeout: 15_000 })
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
    await expect(page.getByText("Sin coincidencias en los movimientos")).toBeVisible({ timeout: 15_000 })
    // Sin filas no queda un paginador huérfano flotando bajo la tabla ausente.
    await expect(page.getByRole("navigation", { name: /paginaci/i })).toHaveCount(0)
  })

  test("registra un ajuste con folio y lo deja consultable en Documentos", async ({ page }) => {
    await page.goto("/bodega")
    await page.getByRole("button", { name: "Registrar movimiento" }).click()

    await page.getByRole("button", { name: /^Ajuste/ }).click()
    await page.getByRole("combobox", { name: "Faena", exact: true }).click()
    await page.getByRole("option").first().click()

    // Las opciones llegan del endpoint por faena, no del render de la página.
    const productTrigger = page.locator("#adjustProductId")
    await expect(productTrigger).toBeVisible()
    await productTrigger.click()
    await page.getByRole("option").first().click()

    // El saldo actual queda a la vista antes de corregirlo.
    await expect(page.getByText(/Stock actual/)).toBeVisible()

    // BOD-04: se captura la cantidad real y la pantalla muestra el resultado.
    // Mientras no difiera del saldo (campo vacío) no se puede registrar.
    await expect(page.getByRole("button", { name: "Registrar ajuste" })).toBeDisabled()
    await page.getByLabel("Cantidad real en bodega").fill("12345")
    await expect(page.getByText(/se suman/)).toBeVisible()
    await expect(page.getByRole("button", { name: "Registrar ajuste" })).toBeEnabled()
    await page.locator("#adjustReason").fill("Ajuste e2e")
    await page.getByRole("button", { name: "Registrar ajuste" }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 20_000 })

    // Se afirma el efecto persistido y no el toast: el aviso dura 4 s y puede
    // desaparecer antes de que el test lo alcance (hasta 2026-09-24, además,
    // se lo llevaba el remontaje de la plataforma al revalidar). El folio en
    // Documentos prueba más y no depende del tiempo de vida de una
    // notificación.
    await page.goto("/bodega/documentos?faena=todas")
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

    // TRV-02: por defecto sólo lo que tiene stock; el catálogo completo está
    // detrás de un botón (no existe si todo el catálogo ya tiene saldo).
    const showAll = page.getByRole("button", { name: /Mostrar todo el catálogo/ })
    if (await showAll.isVisible().catch(() => false)) await showAll.click()

    const firstQty = page.locator('input[name="countedQuantity"]:visible').first()
    await expect(firstQty).toBeVisible()
    await firstQty.fill("7")
    await expect(page.getByText(/1 contado/)).toBeVisible()
    await page.getByRole("button", { name: "Guardar borrador" }).click()
    await expect(page.getByText(/Borrador CON-\d{4}-\d{4} guardado/)).toBeVisible({ timeout: 15_000 })

    // Reabrir: el conteo se retoma donde quedó en vez de empezar de nuevo.
    await page.reload()
    await page.getByRole("button", { name: "Registrar movimiento" }).click()
    await page.getByRole("button", { name: /Conteo físico/ }).click()
    await page.getByRole("combobox", { name: "Faena", exact: true }).click()
    await page.getByRole("option").first().click()
    await expect(page.getByText(/Retomando el borrador CON-\d{4}-\d{4}/)).toBeVisible({ timeout: 15_000 })

    // TRV-02: el cierre pide confirmación con el resumen de ajustes.
    await page.getByRole("button", { name: "Cerrar conteo" }).click()
    const confirm = page.getByRole("dialog").filter({ hasText: "sin contar" })
    await expect(confirm).toBeVisible()
    await confirm.getByRole("button", { name: "Cerrar conteo" }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 20_000 })
    // El conteo cerrado queda con su folio en Documentos; el toast de cierre es
    // efímero (4 s) y no sirve de señal.
    await page.goto("/bodega/documentos?faena=todas")
    await expect(page.getByText(/CON-\d{4}-\d{4}/).first()).toBeVisible({ timeout: 15_000 })
  })

  test("da de baja existencias con folio DES propio", async ({ page }) => {
    await page.goto("/bodega")
    await page.getByRole("button", { name: "Registrar movimiento" }).click()
    await page.getByRole("button", { name: /^Baja o merma/ }).click()
    await page.getByRole("combobox", { name: "Faena", exact: true }).click()
    await page.getByRole("option").first().click()

    const productTrigger = page.locator("#discardProductId")
    await expect(productTrigger).toBeVisible()
    await productTrigger.click()
    await page.getByRole("option").first().click()

    await page.getByLabel("Cantidad a dar de baja").fill("1")
    await page.locator("#discardReason").fill("Dañado en e2e")
    await page.getByRole("button", { name: "Registrar baja" }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 20_000 })

    await page.goto("/bodega/documentos?faena=todas")
    await expect(page.getByText(/DES-\d{4}-\d{4}/).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("Dañado en e2e").first()).toBeVisible()
  })

  // El stock mínimo y la columna Estado se retiraron el 2026-10-02.
  test("ya no ofrece stock mínimo ni estado", async ({ page }) => {
    await page.goto("/bodega")

    await expect(page.getByRole("columnheader", { name: "En bodega" })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("columnheader", { name: "Estado", exact: true })).toHaveCount(0)
    await expect(page.getByRole("columnheader", { name: "Mínimo", exact: true })).toHaveCount(0)
    await expect(page.getByRole("combobox", { name: "Filtrar por estado de stock" })).toHaveCount(0)
    await expect(page.getByText(/stock mínimo/i)).toHaveCount(0)

    await page.getByRole("button", { name: "Registrar movimiento" }).click()
    await expect(page.getByRole("button", { name: /Conteo físico/ })).toBeVisible()
    await expect(page.getByRole("button", { name: /Definir stock mínimo/ })).toHaveCount(0)
  })

  test("las guías de despacho tienen entrada en el menú", async ({ page }) => {
    await page.goto("/bodega")

    const guides = page.getByRole("link", { name: "Guías de despacho" })
    await expect(guides.first()).toBeVisible()
    await guides.first().click()
    await expect(page).toHaveURL(/\/bodega\/guias/)
    // Título y filtros propios de la lista (ya no "Historial de guías internas").
    await expect(page.getByRole("combobox", { name: "Filtrar por estado" })).toBeVisible()
  })
})
