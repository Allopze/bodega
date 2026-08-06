import { test, expect } from "@playwright/test"
import { login } from "./helpers"

const OC_FIXTURE_ID = "oc-e2e"
/** OC recibida completa y sin factura adjunta. */
const OC_SIN_FACTURA_ID = "oc-sin-factura-e2e"

test.describe("Conciliación OC-factura-recepción", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("OC detail page loads and shows conciliación panel", async ({ page }) => {
    await page.goto(`/compras/${OC_FIXTURE_ID}`)
    await expect(page.getByRole("heading", { name: /OC-2026/ })).toBeVisible({ timeout: 10_000 })

    // The reconciliation panel lives in the "Facturación" tab (OcDetailTabs),
    // which isn't the default active tab, and only renders once the OC has
    // an invoice attached.
    await page.getByRole("tab", { name: "Facturación" }).click()
    const conciliacion = page.getByText("Conciliación por ítem")
    await expect(conciliacion).toBeVisible({ timeout: 10_000 })
    // `exact`: la advertencia de conciliación del rail ("Total facturado difiere
    // del total OC") también contiene el texto desde que se muestra antes del cierre.
    await expect(page.getByText("Total facturado", { exact: true })).toBeVisible()
  })

  // Antes había que saber que existía la pestaña "Facturación" y bajar hasta el
  // final de su formulario para encontrar el campo del archivo.
  test("una OC recibida sin factura ofrece adjuntarla desde el rail", async ({ page }) => {
    await page.goto(`/compras/${OC_SIN_FACTURA_ID}`)
    await expect(page.getByText("Falta la factura de esta orden")).toBeVisible({ timeout: 10_000 })

    const cta = page.getByRole("link", { name: /adjuntar factura/i })
    await expect(cta).toHaveAttribute("href", `/compras/${OC_SIN_FACTURA_ID}?tab=facturacion`, { timeout: 10_000 })
    await cta.click()

    // El deep-link abre la pestaña y el archivo es el primer control del
    // formulario: es lo que auto-completa el resto vía DTE/OCR.
    await expect(page.getByRole("heading", { name: "Adjuntar factura" })).toBeVisible({ timeout: 10_000 })
    const form = page.locator("form").filter({ has: page.locator("#invoice-file") })
    const firstControl = form.locator("input:not([type=hidden]), select, textarea").first()
    await expect(firstControl).toHaveAttribute("id", "invoice-file")
  })

  test("el listado delata la OC recibida sin factura y permite filtrarla", async ({ page }) => {
    await page.goto("/compras?factura=pendiente")
    await expect(page.getByRole("link", { name: /Ver OC OC-2026-0091/ })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("Sin factura").first()).toBeVisible()
    // La OC con factura no pasa el filtro.
    await expect(page.getByRole("link", { name: /Ver OC OC-2026-0001/ })).toHaveCount(0)

    // El filtro se activa desde el chip del header, no desde la barra: sin un
    // control visible, la lista quedaba recortada sin explicación ni salida.
    // El chip es un enlace con href real, no un botón: así funciona desde el
    // primer pintado, sin esperar a que el componente hidrate.
    // Esperar a que el cliente termine de cargar antes de hacer clic: el
    // elemento es accionable desde el HTML del servidor, así que Playwright
    // clickea antes de que React hidrate. Ahí `Link` ya hace preventDefault
    // pero el router todavía no navega, y el clic se pierde sin dejar rastro
    // —la URL simplemente no cambia y la aserción agota sus 10 s.
    // `networkidle` no alcanza: vuelve apenas la red se calma, que puede ser
    // antes de que React termine de hidratar. En esa ventana `Link` ya hace
    // preventDefault pero el router todavía no navega, así que el clic se pierde
    // en silencio. Se reintenta hasta que el cliente lo toma; el destino es el
    // mismo, así que repetirlo no tiene efecto secundario.
    await expect.poll(async () => {
      const chip = page.getByRole("link", { name: /Quitar filtro de facturas pendientes/i })
      if (await chip.count()) await chip.click().catch(() => undefined)
      return page.url()
    }, { timeout: 15_000 }).not.toMatch(/factura=pendiente/)
    await expect(page.getByRole("link", { name: /Ver OC OC-2026-0001/ })).toBeVisible({ timeout: 10_000 })

    // Y "Limpiar" —que sólo aparece con filtros activos— también lo apaga.
    // Este sí es un <button> con onClick: sin hidratar no hace absolutamente
    // nada, y es el que fallaba de forma reproducible en local.
    await page.goto("/compras?factura=pendiente")
    await expect.poll(async () => {
      const limpiar = page.getByRole("button", { name: "Limpiar" })
      if (await limpiar.count()) await limpiar.click().catch(() => undefined)
      return page.url()
    }, { timeout: 15_000 }).not.toMatch(/factura=pendiente/)
  })

  // El número de guía se tipea en la recepción, con el documento en la mano.
  test("desde la recepción se adjunta la factura con el N° de guía ya puesto", async ({ page }) => {
    await page.goto("/recepcion/rec-sin-factura-e2e")
    await expect(page.getByRole("heading", { name: "REC-2026-0091" })).toBeVisible({ timeout: 10_000 })

    const atajo = page.getByRole("link", { name: /Adjuntar factura/i })
    await expect(atajo).toHaveAttribute(
      "href",
      "/compras/oc-sin-factura-e2e?tab=facturacion&nro=GD-77123",
    )
    await atajo.click()

    await expect(page.getByRole("heading", { name: "Adjuntar factura" })).toBeVisible({ timeout: 10_000 })
    await expect(page.locator("#invoice-number")).toHaveValue("GD-77123")
  })
})
