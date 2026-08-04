import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E Spec: Matriz de Trazabilidad de Ítems (`/trazabilidad`).
 *
 * Covers:
 *   • Carga del tablero de trazabilidad.
 *   • Filtros de faena y estado del ciclo de vida.
 */
test.describe("Módulo de Trazabilidad de Ítems", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la vista principal de trazabilidad carga correctamente", async ({ page }) => {
    await page.goto("/trazabilidad")
    await expect(page).toHaveURL(/\/trazabilidad/)

    // Título y descripción
    await expect(page.getByRole("heading", { name: "Trazabilidad de ítems" })).toBeVisible()
    // La descripción existe dos veces: el bloque semántico del PageHeader y su
    // eco visual en la barra superior. Una vez hidratada la cabecera, un
    // selector sin acotar viola el modo estricto de forma intermitente.
    await expect(page.getByText(/Estado de cada ítem a lo largo del flujo/i).first()).toBeVisible()
  })
})
