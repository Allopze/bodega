import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E Spec: Reporte de Acta Imprimible y Exportación PDF de Inspecciones SST.
 *
 * Cubre:
 *   • Renderizado de la vista de impresión HTML limpia (`/prevencion/inspecciones/[runId]/print`).
 *   • Verificación de secciones clave en el acta (metadatos, respuestas, hallazgos, firmas).
 *   • Descarga del archivo PDF generado con validación de cabecera binaria `%PDF-`.
 */

test.describe("Inspecciones — Reporte de Acta y Exportación PDF", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la vista de impresión contiene todos los bloques reglamentarios del acta", async ({ page }) => {
    // Usamos la inspección ejecutada del fixture `insp-e2e-bloqueada`
    await page.goto("/prevencion/inspecciones/insp-e2e-bloqueada/print")

    /* Las aserciones se acotan a `.sheet`, que es la hoja A4 —el artefacto
     * legal— y lo único visible en viewport de escritorio. La página renderiza
     * ANTES un `MobileDocumentSummary` que repite los mismos datos y que está
     * en `display: none` sobre 760px, así que un `.first()` sin ámbito resolvía
     * al nodo oculto y `toBeVisible()` fallaba con razón. */
    const acta = page.locator(".sheet")

    // 1. Cabecera y datos de identificación
    await expect(acta.getByText("INSP-E2E-0003").first()).toBeVisible({ timeout: 30_000 })
    await expect(acta.getByText("Faena E2E").first()).toBeVisible()
    await expect(acta.getByText("Extintor Taller E2E").first()).toBeVisible()

    // 2. Cumplimiento porcentual y estado
    await expect(acta.getByText("80%").first()).toBeVisible()

    // 3. Tabla de hallazgos detectados
    await expect(acta.getByText(/Manómetro/i).first()).toBeVisible()

    // 4. Bloque de firmas
    await expect(acta.getByText(/Firma/i).first()).toBeVisible()
  })

  test("el endpoint /print/pdf entrega un archivo binario PDF válido", async ({ page }) => {
    const response = await page.request.get("/prevencion/inspecciones/insp-e2e-bloqueada/print/pdf")
    expect(response.status()).toBe(200)
    expect(response.headers()["content-type"]).toMatch(/application\/pdf/)

    const buffer = await response.body()
    // Magic bytes de PDF
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-")
    expect(buffer.length).toBeGreaterThan(500)
  })
})
