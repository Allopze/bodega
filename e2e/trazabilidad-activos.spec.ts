import { test, expect } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E Spec: Trazabilidad y Seguimiento por Faena (`/bodega/trazabilidad`).
 *
 * Covers:
 *   • Carga de la vista consolidada.
 *   • Las dos pestañas (seguimiento por faena y búsqueda por código).
 *   • La redirección de compatibilidad desde `/trazabilidad`.
 *
 * El spec apuntaba a `/trazabilidad` y afirmaba el encabezado de la matriz
 * vieja ("Trazabilidad de ítems"), texto que ya no existe en el código: pasaba
 * la aserción de URL por casualidad —`/bodega/trazabilidad` también matchea el
 * regex— y fallaba en la del título.
 */
test.describe("Módulo de Trazabilidad por Faena", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la vista consolidada carga correctamente", async ({ page }) => {
    await page.goto("/bodega/trazabilidad")

    await expect(
      page.getByRole("heading", { name: "Trazabilidad y Seguimiento por Faena" }),
    ).toBeVisible()
    // La descripción existe dos veces: el bloque semántico del PageHeader y su
    // eco visual en la barra superior. Una vez hidratada la cabecera, un
    // selector sin acotar viola el modo estricto de forma intermitente.
    await expect(page.getByText(/Estado completo de materiales/i).first()).toBeVisible()
    await expect(page.getByLabel("Seleccionar faena")).toBeVisible()
  })

  test("la pestaña de búsqueda por código abre el buscador", async ({ page }) => {
    await page.goto("/bodega/trazabilidad?faena=ws-audit-1")

    await page.getByRole("link", { name: /Buscar por código/i }).click()

    await expect(page).toHaveURL(/tab=documento/)
    await expect(page.getByRole("searchbox", { name: /Código del documento/i })).toBeVisible()
    // La faena viaja en la URL: perderla al cambiar de pestaña obligaba a
    // re-seleccionarla al volver.
    await expect(page).toHaveURL(/faena=ws-audit-1/)
  })

  test("la ruta legada redirige a la vista de Bodega", async ({ page }) => {
    await page.goto("/trazabilidad")

    await expect(page).toHaveURL(/\/bodega\/trazabilidad/)
    await expect(
      page.getByRole("heading", { name: "Trazabilidad y Seguimiento por Faena" }),
    ).toBeVisible()
  })
})
