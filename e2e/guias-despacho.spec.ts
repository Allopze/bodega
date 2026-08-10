/**
 * E2E: Guías de Despacho Internas (GDI) — flujo Oficina → Faena.
 *
 * Cubre lo que sólo se ve con el navegador puesto: que la interfaz no ofrezca
 * otro origen, el circuito crear → despachar → PDF → confirmar recepción, el
 * movimiento de bodega que produce, y el corte por permisos.
 */
import { expect, test } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { login } from "./helpers"

const OFFICE_LABEL = "Oficina CHOME"

async function parsePdf(buf: Buffer) {
  const { PDFParse } = await import("pdf-parse")
  const parser = new PDFParse({ data: buf })
  try {
    const result = await parser.getText()
    return { pageCount: result.total, text: result.text }
  } finally {
    await parser.destroy()
  }
}

async function pickCombobox(page: import("@playwright/test").Page, label: RegExp, optionName: RegExp) {
  const input = page.getByLabel(label)
  await input.click()
  await page.getByRole("option", { name: optionName }).first().click()
}

/**
 * Los toasts de éxito se apilan arriba a la derecha, encima de las acciones del
 * TopBar. Se espera a que se cierren solos antes de pulsar la acción siguiente
 * (si no, el clic aterriza en el toast y el test se vuelve intermitente).
 */
async function waitForToastsToClear(page: import("@playwright/test").Page) {
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 })
}

/** El folio se lee de la página, que es donde el usuario lo ve. */
async function readGuideCode(page: import("@playwright/test").Page) {
  const body = await page.locator("body").textContent()
  return body?.match(/GDI-\d{6}/)?.[0]
}

test.describe("Guías de despacho internas", () => {
  test("crea, despacha, descarga el PDF y confirma la recepción", async ({ page, request }) => {
    await login(page)
    await page.setViewportSize({ width: 1440, height: 950 })

    await page.goto("/bodega/guias")
    await expect(page.getByRole("heading", { level: 1, name: /Guías de despacho internas/i })).toBeVisible()

    await page.getByRole("link", { name: /Nueva guía/i }).click()
    await expect(page).toHaveURL(/\/bodega\/guias\/nueva/)

    // 1. El origen es un dato fijo, no un control: no hay forma de elegir otro
    //    ni de invertir el traslado.
    const origin = page.getByTestId("guide-origin")
    await expect(origin).toContainText(OFFICE_LABEL)
    await expect(origin).toContainText("Oficina Central E2E")
    expect(await origin.locator("input, select, button").count()).toBe(0)
    expect(await page.locator('[name="originWorksiteId"]').count()).toBe(0)

    // 2. Destino obligatorio desde el catálogo de faenas; la oficina no está.
    const destination = page.getByLabel(/Faena de destino/i)
    await destination.click()
    await expect(page.getByRole("option", { name: "Faena E2E" })).toBeVisible()
    await expect(page.getByRole("option", { name: /Oficina Central E2E/ })).toHaveCount(0)
    await page.getByRole("option", { name: "Faena E2E" }).first().click()

    // 3. Elementos desde el stock de la oficina.
    const productPicker = page.getByPlaceholder(/Agregar producto/i)
    await productPicker.click()
    await page.getByRole("option", { name: /Casco EPP E2E/ }).first().click()
    await page.getByLabel("Cantidad").first().fill("4")

    await productPicker.click()
    await page.getByRole("option", { name: /Guante E2E/ }).first().click()
    await page.getByLabel("Cantidad").nth(1).fill("6")

    // 4. Responsables y transporte reutilizando los catálogos existentes.
    await pickCombobox(page, /Responsable de recepción en faena/i, /Trabajador E2E/)
    await pickCombobox(page, /^Vehículo$/i, /E2E-FUEL-1/)
    await expect(page.getByText("Hilux")).toBeVisible()

    await page.getByLabel(/Observaciones/i).fill("Traslado E2E de EPP y materiales")
    await page.getByRole("button", { name: /Guardar borrador/i }).click()

    // 5. Ficha de la guía en borrador, con correlativo GDI.
    //    El `?creada=1` del redirect es lo que distingue la ficha del propio
    //    formulario: `/bodega/guias/[^/]+` también calza con `/nueva`.
    await expect(page).toHaveURL(/\/bodega\/guias\/[^/?]+\?creada=1/)
    await expect(page.getByRole("heading", { level: 1, name: /^Guía GDI-\d{6}$/ })).toBeVisible()
    const guideUrl = new URL(page.url())
    const guideId = guideUrl.pathname.split("/").pop()!
    const code = await readGuideCode(page)
    expect(code).toMatch(/^GDI-\d{6}$/)
    await expect(page.getByText("Borrador").first()).toBeVisible()
    await expect(page.getByText(/Todavía no hay movimientos/)).toBeVisible()

    // 6. Despachar: confirma, mueve stock y sella el documento.
    await page.getByRole("button", { name: /^Despachar$/ }).click()
    await expect(page.getByRole("dialog")).toContainText(/Se descontarán/)
    await page.getByRole("dialog").getByRole("button", { name: /^Despachar$/ }).click()

    await expect(page.getByText("Despachada").first()).toBeVisible({ timeout: 15_000 })
    // Guía ↔ movimiento: dos patas por línea (salida de oficina, ingreso a faena).
    await expect(page.getByRole("cell", { name: "Salida por guía" })).toHaveCount(2)
    await expect(page.getByRole("cell", { name: "Ingreso por guía" })).toHaveCount(2)

    // 7. El kardex de bodega ve el mismo movimiento desde el otro lado.
    await page.goto("/bodega")
    await expect(page.getByText(/Salida por guía|Ingreso por guía/).first()).toBeVisible()

    // 8. PDF A4 servidor: se genera con el contenido y la leyenda del documento.
    const cookies = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ")
    const pdfResponse = await request.get(`/bodega/guias/${guideId}/print/pdf`, { headers: { cookie: cookies } })
    expect(pdfResponse.status()).toBe(200)
    expect(pdfResponse.headers()["content-type"]).toMatch(/application\/pdf/)
    expect(pdfResponse.headers()["content-disposition"]).toContain("Guia despacho interna")

    const body = await pdfResponse.body()
    expect(body.slice(0, 5).toString("ascii")).toBe("%PDF-")
    const { pageCount, text } = await parsePdf(body)
    expect(pageCount).toBe(1)
    const flat = text.replace(/\s+/g, " ")
    expect(flat).toContain("GUÍA DE DESPACHO INTERNA".replace(/\s+/g, " "))
    expect(flat).toContain(code!)
    expect(flat).toContain(OFFICE_LABEL)
    expect(flat).toContain("Faena E2E")
    expect(flat).toContain("No constituye documento tributario")
    expect(flat).toContain("Casco EPP E2E")

    // 8b. La hoja A4 es una página del sitio, no una imagen: se audita como tal.
    await page.goto(`/bodega/guias/${guideId}/print`)
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("main", { name: new RegExp(`Guía de despacho interna ${code}`) })).toBeVisible()
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .disableRules(["color-contrast"])
      .analyze()
    expect(axe.violations).toEqual([])

    // 9. Confirmar recepción en faena: no vuelve a mover stock.
    await page.goto(`/bodega/guias/${guideId}`)
    await waitForToastsToClear(page)
    await page.getByRole("button", { name: /Confirmar recepción/i }).click()
    await page.getByRole("dialog").getByRole("button", { name: /Confirmar recepción/i }).click()
    await expect(page.getByText("Recibida").first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("cell", { name: "Salida por guía" })).toHaveCount(2)

    // 10. Ya recibida, no se puede volver a despachar ni a recibir.
    await expect(page.getByRole("button", { name: /^Despachar$/ })).toHaveCount(0)
    await expect(page.getByRole("button", { name: /Confirmar recepción/i })).toHaveCount(0)

    // 11. Consulta histórica: aparece en el listado con su estado y faena.
    await page.goto("/bodega/guias?estado=received")
    await expect(page.getByRole("link", { name: code!, exact: true })).toBeVisible()
    const row = page.getByRole("row", { name: new RegExp(code!) })
    await expect(row).toContainText("Faena E2E")
    await expect(row).toContainText("Recibida")
  })

  test("anula una guía despachada exigiendo motivo y revirtiendo el stock", async ({ page }) => {
    await login(page)
    await page.setViewportSize({ width: 1440, height: 950 })

    await page.goto("/bodega/guias/nueva")
    await page.getByLabel(/Faena de destino/i).click()
    await page.getByRole("option", { name: "Faena E2E" }).first().click()
    await page.getByPlaceholder(/Agregar producto/i).click()
    await page.getByRole("option", { name: /Guante E2E/ }).first().click()
    await page.getByLabel("Cantidad").first().fill("3")
    await page.getByRole("button", { name: /Guardar borrador/i }).click()

    await expect(page).toHaveURL(/\/bodega\/guias\/[^/?]+\?creada=1/)
    await page.getByRole("button", { name: /^Despachar$/ }).click()
    await page.getByRole("dialog").getByRole("button", { name: /^Despachar$/ }).click()
    await expect(page.getByText("Despachada").first()).toBeVisible({ timeout: 15_000 })

    await waitForToastsToClear(page)
    await page.getByRole("button", { name: /Anular/i }).click()
    const dialog = page.getByRole("dialog")
    // Sin motivo suficiente el botón sigue deshabilitado.
    await expect(dialog.getByRole("button", { name: /Anular guía/i })).toBeDisabled()
    await dialog.getByLabel(/Motivo de la anulación/i).fill("La carga no salió de la oficina")
    await dialog.getByRole("button", { name: /Anular guía/i }).click()

    await expect(page.getByText("Guía anulada")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("La carga no salió de la oficina").first()).toBeVisible()
    // El despacho original se conserva y la reversa se suma: 4 movimientos.
    await expect(page.getByRole("cell", { name: /Salida por guía|Ingreso por guía/ })).toHaveCount(4)
    await expect(page.getByRole("button", { name: /^Despachar$/ })).toHaveCount(0)
  })

  test("un usuario sin el permiso no entra al módulo de guías", async ({ page }) => {
    await login(page, "scoped@e2e.chome.cl", "scoped2026")
    await page.goto("/bodega/guias")
    await expect(page).toHaveURL(/\/forbidden/)
  })
})
