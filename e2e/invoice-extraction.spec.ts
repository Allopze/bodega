import path from "node:path"
import { test, expect } from "@playwright/test"
import { login } from "./helpers"

const OC_FIXTURE_ID = "oc-e2e"
// Factura electrónica real (PDF con capa de texto) usada como muestra en la
// auditoría de OCR: folio 3064428, Treck S.A., total 68.425.
const INVOICE_PDF = path.join(__dirname, "..", "DOC-33-3064428.pdf")

test.describe("Extracción automática de factura", () => {
  test("al adjuntar un PDF con texto se auto-completan N° folio, monto y fecha", async ({ page }) => {
    await login(page)
    await page.goto(`/compras/${OC_FIXTURE_ID}`)
    await page.getByRole("tab", { name: "Facturación" }).click()

    // Con facturas ya adjuntas el alta viene plegada (A3): la sección es la
    // lista y el formulario se abre a pedido. Se apunta al `<summary>` y no al
    // texto: el botón de envío del formulario dice lo mismo.
    await page.locator("details > summary").filter({ hasText: "Adjuntar factura" }).click()
    await page.locator("#invoice-file").setInputFiles(INVOICE_PDF)

    await expect(page.getByText("Datos extraídos del archivo")).toBeVisible({ timeout: 60_000 })
    await expect(page.locator("#invoice-number")).toHaveValue("3064428")
    // Con líneas extraídas el monto es la suma de sus subtotales — el mismo valor
    // que persiste createPurchaseOrderInvoice, no el total con IVA del documento.
    await expect(page.locator("#invoice-amount")).toHaveValue("57500")
    // El DatePicker expone la fecha al form en un input oculto (el #id es el botón).
    await expect(page.locator('input[name="issueDate"]')).toHaveValue("2026-07-14")
  })
})
