import { test, expect } from "@playwright/test"
import { login, expectPageTitle } from "./helpers"

/**
 * E2E Spec: Matriz de Identificación de Peligros y Evaluación de Riesgos (MIPER).
 *
 * Cubre:
 *   • Renderizado del workbench MIPER y visualización de matrices de faenas.
 *   • Navegación por las pestañas del workbench (Matriz, Controles, Importaciones).
 *   • Visualización del Mapa de Calor de Riesgos.
 */

test.describe("Prevención — Matriz MIPER y Controles", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("el workbench de MIPER carga con sus controles y selector de faena", async ({ page }) => {
    await page.goto("/prevencion/miper")
    await expect(page).toHaveURL(/\/prevencion\/miper/)
    await expectPageTitle(page, "Matriz IPER (MIPER)")

    // La matriz del fixture entra por la pestaña "Todas"; la bandeja "Por hacer"
    // del admin no la lista. Se cuenta que haya al menos una fila de la faena en
    // vez de fijar una fila concreta: el rótulo de la legacy cambia según lo que
    // haya dejado otra prueba de la misma corrida —«Vigente · metodología
    // anterior» mientras está sola, «Reemplazado» cuando la MIPER del período la
    // reemplaza— y con dos filas de "Faena E2E" ni `textoVisible` ni `.first()`
    // son buenos: el primero resuelve a dos nodos y el segundo esconde cuál.
    await page.getByRole("tab", { name: "Todas" }).click()
    const filas = page.getByRole("row").filter({ hasText: "Faena E2E" })
    await expect.poll(() => filas.count(), { timeout: 30_000 }).toBeGreaterThan(0)
    await expect(page.getByRole("table", { name: "MIPER por faena y período" })).toBeVisible()
  })

  // El mapa se trasladó a CGRD el 2026-09-22. El flujo completo del plano y sus
  // marcadores vive en prevencion-cgrd-risk-map.spec.ts; acá sólo queda que la
  // pantalla responde y se titula como corresponde.
  test("navegación al mapa de riesgos interactivo", async ({ page }) => {
    await page.goto("/prevencion/cgrd/mapa")
    await expect(page).toHaveURL(/\/prevencion\/cgrd\/mapa/)
    await expectPageTitle(page, /Mapa de riesgos|Peligros y riesgos/i)
  })
})
