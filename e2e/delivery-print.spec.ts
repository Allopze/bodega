import { test, expect } from "@playwright/test"
import { login } from "./helpers"

test.describe("Entregas — comprobante firmado", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("comprobante print page loads with delivery data", async ({ page }) => {
    // El artefacto A4 y el resumen móvil son dos vistas distintas por diseño
    // (TASK-UI-013): a 390 px el documento se oculta y se muestra el resumen.
    // Sin fijar el ancho, esta prueba heredaba el viewport del proyecto y bajo
    // `mobile-safari` buscaba el A4 en la vista que lo esconde a propósito.
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto("/entregas/del-e2e/print")
    await expect(page.getByText("Comprobante de Entrega EPP")).toBeVisible()
    // El comprobante muestra el folio en tres lugares por diseño —nombre de
    // archivo, resumen móvil y código del documento—, así que el selector
    // apunta al código en sí y no a cualquier mención.
    await expect(page.locator("p.code", { hasText: "ENT-2026-0001" })).toBeVisible()
  })

  test("muestra un resumen legible en móvil y anuncia un error al fallar el PDF", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/entregas/del-e2e/print")

    await expect(page.getByRole("main", { name: /Resumen de/i })).toBeVisible()
    await expect(page.getByText("Productos entregados")).toBeVisible()
    await expect(page.getByRole("button", { name: "Descargar PDF" })).toBeVisible()

    await page.route("**/entregas/del-e2e/print/pdf", (route) => route.fulfill({ status: 503 }))
    await page.getByRole("button", { name: "Descargar PDF" }).click()

    await expect(page.getByRole("status")).toHaveText(/No se pudo generar el PDF \(Error 503\)\. Intenta nuevamente\./)
  })
})
