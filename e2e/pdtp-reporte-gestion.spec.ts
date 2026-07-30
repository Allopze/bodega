import { expect, test } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E: PDTP — Reporte de gestión (/prevencion/pdtp/[programId]/reporte).
 *
 * Antes de este spec la página no tenía ningún test, ni de componente ni
 * e2e. Usa el fixture pdtp-prog-e2e (activo, año 2026, 2 faenas visibles) —
 * al haber más de una faena, la selección no se autoselecciona y hay que
 * pasar ?faena= explícito.
 *
 * pdtp-act-e2e tiene una fila de planificación (mes 1, semana 1, 1
 * planificado) y una ejecución aprobada que la iguala (e2e/setup-db.ts:
 * pdtp-sched-e2e / pdtp-exec-approved-e2e), así que su actividad
 * cumple la meta por defecto del programa (90%).
 */
test.describe("PDTP — Reporte de gestión", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("sin faena seleccionada pide elegir una", async ({ page }) => {
    await page.goto("/prevencion/pdtp/pdtp-prog-e2e/reporte")

    await expect(page.getByText("Selecciona una faena para ver el reporte")).toBeVisible()
    await page.getByRole("link", { name: "Faena E2E" }).click()

    await expect(page).toHaveURL(/faena=ws-e2e/)
  })

  test("con faena seleccionada muestra la tabla de actividades y permite filtrar", async ({ page }) => {
    await page.goto("/prevencion/pdtp/pdtp-prog-e2e/reporte?faena=ws-e2e")

    await expect(page.getByRole("columnheader", { name: "Actividad" })).toBeVisible()
    await expect(page.getByRole("columnheader", { name: "Planificado" })).toBeVisible()
    const row = page.getByRole("row").filter({ hasText: "Charla de seguridad E2E" })
    await expect(row).toBeVisible()
    await expect(row.getByText("Cumple meta")).toBeVisible()

    // Filtrar por "En desviación" no matchea la única actividad seed (que
    // cumple la meta) → EmptyState por filtro, no por faena.
    await page.getByRole("combobox", { name: "Estado" }).click()
    await page.getByRole("option", { name: "En desviación" }).click()
    await expect(page).toHaveURL(/estado=deviates/)
    await expect(page.getByText("Sin actividades para estos filtros")).toBeVisible()

    await page.getByRole("link", { name: "Quitar filtros" }).click()
    await expect(page.getByRole("row").filter({ hasText: "Charla de seguridad E2E" })).toBeVisible()
  })

  test("el botón Descargar Excel solo aparece con faena seleccionada y dispara la descarga", async ({ page }) => {
    await page.goto("/prevencion/pdtp/pdtp-prog-e2e/reporte")
    await expect(page.getByRole("link", { name: "Descargar Excel" })).toHaveCount(0)

    await page.goto("/prevencion/pdtp/pdtp-prog-e2e/reporte?faena=ws-e2e")
    const downloadPromise = page.waitForEvent("download")
    await page.getByRole("link", { name: "Descargar Excel" }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/pdtp-reporte-gestion-2026\.xlsx/)
  })
})
