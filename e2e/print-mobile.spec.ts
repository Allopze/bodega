import { expect, test } from "@playwright/test"
import { login } from "./helpers"

const PRINT_DOCUMENTS = [
  {
    name: "Orden de compra",
    path: "/compras/oc-e2e/print",
    pdfPath: "**/compras/oc-e2e/print/pdf",
    section: "Compra",
  },
  {
    name: "Acta SST",
    path: "/sst/sst-eval-e2e/print",
    pdfPath: "**/sst/sst-eval-e2e/print/pdf",
    section: "Evaluación",
  },
] as const

test.describe("Documentos A4 — lectura móvil y descarga", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.setViewportSize({ width: 390, height: 844 })
  })

  for (const document of PRINT_DOCUMENTS) {
    test(`${document.name}: conserva resumen HTML y explica un fallo de PDF`, async ({ page }) => {
      await page.goto(document.path)

      const summary = page.getByRole("main", { name: /Resumen de/i })
      await expect(summary).toBeVisible()
      await expect(summary.getByRole("heading", { level: 2, name: document.section })).toBeVisible()
      await expect(page.getByRole("button", { name: "Descargar PDF" })).toBeVisible()

      await page.route(document.pdfPath, (route) => route.fulfill({ status: 503 }))
      await page.getByRole("button", { name: "Descargar PDF" }).click()

      await expect(page.getByRole("status")).toHaveText(/No se pudo generar el PDF \(Error 503\)\. Intenta nuevamente\./)
    })
  }
})
