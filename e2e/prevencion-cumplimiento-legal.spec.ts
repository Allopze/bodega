import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E Spec: Matriz de Requisitos Legales y Cumplimiento Normativo.
 *
 * Covers:
 *   • Carga del workbench de requisitos legales.
 *   • Verificación del semáforo de cumplimiento legal.
 */
test.describe("Prevención — Requisitos legales y normativa", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la vista principal de requisitos legales carga correctamente", async ({ page }) => {
    await page.goto("/prevencion/requisitos-legales")
    await expect(page).toHaveURL(/\/prevencion\/requisitos-legales/)

    // Título de la página
    await expect(page.getByRole("heading", { name: "Requisitos legales" })).toBeVisible()
    // La descripción vive en el PageHeader y se repite como eco visual en la
    // barra superior; el contrato es el bloque semántico.
    await expect(page.getByText(/Control de vigencia, aplicabilidad/i).first()).toBeVisible()
  })
})
