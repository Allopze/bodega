/**
 * E2E: la GDI nace en Recepciones después de recibir en Oficina CHOME.
 *
 * El histórico sigue consultable en /bodega/guias, pero no existe un alta
 * operativa independiente: el caso de prueba arranca en la OC de fixture,
 * registra la llegada del proveedor, sigue la guía preparada y coteja faena.
 */
import { expect, test } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { login, receiptSubmitName, receiptStageCard } from "./helpers"

const OFFICE_LABEL = "Oficina CHOME"
const OC_ID = "oc-gdi-e2e"

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

async function waitForToastsToClear(page: import("@playwright/test").Page) {
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 })
}

test.describe("Guías de despacho internas", () => {
  test("se prepara desde Recepciones, despacha, genera PDF y coteja en faena", async ({ page, request }) => {
    await login(page)
    await page.setViewportSize({ width: 1440, height: 950 })

    // 1. La primera acción es la recepción del proveedor en Oficina CHOME.
    await page.goto(`/recepcion/nueva?oc=${OC_ID}`)
    await receiptStageCard(page, "Oficina").click()
    await page.getByLabel("Cantidad a recibir de Guante E2E").fill("6")
    await page.getByRole("button", { name: receiptSubmitName("Oficina") }).click()
    await expect(page.getByRole("heading", { name: /^REC-/ })).toBeVisible({ timeout: 30_000 })

    // 2. La recepción ya trae la GDI preparada: no se vuelve a ingresar OC,
    // faena, productos ni cantidades a mano.
    const guideLink = page.getByRole("link", { name: /^GDI-\d{6}$/ }).first()
    await expect(guideLink).toBeVisible()
    const guideCode = (await guideLink.textContent())?.trim() ?? ""
    expect(guideCode).toMatch(/^GDI-\d{6}$/)
    await expect(page.getByText(/6 despachadas|6 disponibles para despachar/)).toBeVisible()
    await guideLink.click()

    await expect(page.getByRole("heading", { name: `Guía ${guideCode}` })).toBeVisible()
    await expect(page.getByText(OFFICE_LABEL).first()).toBeVisible()
    await expect(page.getByText("OC-2026-0093")).toBeVisible()
    await expect(page.getByText("SOL-GDI-E2E")).toBeVisible()
    const guideId = new URL(page.url()).pathname.split("/").pop()!

    // 3. Despachar mueve stock sólo una vez: oficina → faena.
    await page.getByRole("button", { name: /^Despachar$/ }).click()
    await page.getByRole("dialog").getByRole("button", { name: /^Despachar$/ }).click()
    await expect(page.getByText("Despachada").first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("cell", { name: "Salida por guía" })).toHaveCount(1)
    await expect(page.getByRole("cell", { name: "Ingreso por guía" })).toHaveCount(1)

    // 4. El PDF definitivo se emite desde el mismo expediente.
    const cookies = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ")
    const pdfResponse = await request.get(`/bodega/guias/${guideId}/print/pdf`, { headers: { cookie: cookies } })
    expect(pdfResponse.status()).toBe(200)
    expect(pdfResponse.headers()["content-type"]).toMatch(/application\/pdf/)
    const body = await pdfResponse.body()
    expect(body.slice(0, 5).toString("ascii")).toBe("%PDF-")
    const { pageCount, text } = await parsePdf(body)
    expect(pageCount).toBe(1)
    const flat = text.replace(/\s+/g, " ")
    expect(flat).toContain("GUÍA DE DESPACHO INTERNA")
    expect(flat).toContain(guideCode)
    expect(flat).toContain(OFFICE_LABEL)
    expect(flat).toContain("Faena E2E")
    expect(flat).toContain("OC-2026-0093")
    expect(flat).toContain("SOL-GDI-E2E")
    expect(flat).toContain("No constituye documento tributario")
    expect(flat).toContain("Guante E2E")

    // 5. La hoja imprimible conserva estructura accesible.
    await page.goto(`/bodega/guias/${guideId}/print`)
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("main", { name: new RegExp(`Guía de despacho interna ${guideCode}`) })).toBeVisible()
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .disableRules(["color-contrast"])
      .analyze()
    expect(axe.violations).toEqual([])

    // 6. Cotejo final: no vuelve a mover stock y cierra la guía.
    await page.goto(`/bodega/guias/${guideId}`)
    await waitForToastsToClear(page)
    await page.getByRole("button", { name: /Confirmar recepción/i }).click()
    await page.getByRole("dialog").getByRole("button", { name: /Confirmar recepción/i }).click()
    await expect(page.getByText("Recibida").first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("cell", { name: "Salida por guía" })).toHaveCount(1)

    // 7. El historial queda disponible, pero no ofrece alta independiente.
    await page.goto("/bodega/guias?estado=received")
    await expect(page.getByRole("link", { name: guideCode, exact: true })).toBeVisible()
    await expect(page.getByRole("row", { name: new RegExp(guideCode) })).toContainText("Recibida")
    await expect(page.getByRole("link", { name: /Nueva guía/i })).toHaveCount(0)

    await page.goto("/bodega/guias/nueva")
    await expect(page).toHaveURL(/\/recepcion(?:\?|$)/)
  })

  test("un usuario sin el permiso no entra al histórico de guías", async ({ page }) => {
    await login(page, "scoped@e2e.chome.cl", "scoped2026")
    await page.goto("/bodega/guias")
    await expect(page).toHaveURL(/\/forbidden/)
  })
})
