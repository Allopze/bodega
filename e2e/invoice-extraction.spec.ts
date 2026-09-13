import { test, expect } from "@playwright/test"
import { login } from "./helpers"
import { buildInvoicePdf, INVOICE } from "./fixtures/invoice-pdf"

const OC_FIXTURE_ID = "oc-e2e"

test.describe("Extracción automática de factura", () => {
  test("al adjuntar un PDF con texto se auto-completan N° folio, monto y fecha", async ({ page }) => {
    await login(page)
    await page.goto(`/compras/${OC_FIXTURE_ID}`)
    await page.getByRole("tab", { name: "Facturación" }).click()

    // Con facturas ya adjuntas el alta viene plegada (A3): la sección es la
    // lista y el formulario se abre a pedido. Se apunta al `<summary>` y no al
    // texto: el botón de envío del formulario dice lo mismo.
    await page.locator("details > summary").filter({ hasText: "Adjuntar factura" }).click()
    await page.locator("#invoice-file").setInputFiles({
      name: "factura-electronica.pdf",
      mimeType: "application/pdf",
      buffer: buildInvoicePdf(),
    })

    await expect(page.getByText("Datos extraídos del archivo")).toBeVisible({ timeout: 30_000 })
    await expect(page.locator("#invoice-number")).toHaveValue(INVOICE.folio)
    // El documento declara su total, así que el formulario toma ese valor y no la suma
    // de las líneas: `invoices-section.tsx` sólo cae al subtotal cuando el PDF no trae
    // un total extraíble.
    await expect(page.locator("#invoice-amount")).toHaveValue(String(INVOICE.total))
    // El DatePicker expone la fecha al form en un input oculto (el #id es el botón).
    await expect(page.locator('input[name="issueDate"]')).toHaveValue(INVOICE.issueDate)

    // Las líneas se leen de la capa de texto, sin pasar por OCR. Es la regresión de
    // N-01: el extractor aplanaba la página en una sola línea, no encontraba detalle y
    // caía a OCR en toda factura digital.
    await expect(page.getByText("No se detectaron líneas de detalle", { exact: false })).toBeHidden()
    await expect(page.locator('input[name^="item_productName_"]')).toHaveCount(2)
    await expect(page.locator('input[name="item_productName_0"]')).toHaveValue("GUANTE CABRITILLA T9")
  })
})
