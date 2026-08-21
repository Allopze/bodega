import { test, expect } from "@playwright/test"
import { login, expectPageTitle } from "./helpers"

/**
 * E2E Spec: Inspecciones y Auditorías de Seguridad.
 *
 * Covers:
 *   • Carga del listado de ejecuciones y programas de inspección.
 *   • Navegación a las vistas de programas y plantillas.
 *   • La bandeja: KPIs como filtro, filtros por estado, buscador y export.
 *
 * El ciclo de vida completo vive en los archivos hermanos:
 * `prevencion-inspecciones-catalogo`, `-ejecucion` y `-cierre`.
 */
test.describe("Prevención — Inspecciones y auditorías", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("la vista principal de inspecciones carga correctamente", async ({ page }) => {
    await page.goto("/prevencion/inspecciones")
    await expect(page).toHaveURL(/\/prevencion\/inspecciones/)

    // Título de la página
    await expectPageTitle(page, "Inspecciones")
  })

  /**
   * Auditorías del SGSST se fusionó con Inspecciones (2026-08-21): era el mismo
   * motor con los mismos permisos en otro árbol de rutas. La ruta vieja
   * redirige, y el tipo de instrumento —que antes separaba las dos pantallas—
   * es ahora un filtro de la bandeja.
   */
  test("la ruta vieja de auditorías redirige a la bandeja filtrada por tipo", async ({ page }) => {
    await page.goto("/prevencion/auditorias")
    await expect(page).toHaveURL(/\/prevencion\/inspecciones\?tipo=audit/)
    await expectPageTitle(page, "Inspecciones")
    await expect(page.getByText("AUD-E2E")).toBeVisible()
  })

  test("las plantillas de auditoría viven en el mismo catálogo que las demás", async ({ page }) => {
    await page.goto("/prevencion/inspecciones/plantillas")
    await expect(page).toHaveURL(/\/prevencion\/inspecciones\/plantillas/)
    await expectPageTitle(page, "Plantillas de inspección")
    await expect(page.getByText("AUD-E2E")).toBeVisible()
  })
})

/**
 * La bandeja: lo que ve quien entra a decidir qué atender primero.
 *
 * Las aserciones se anclan en `INSP-E2E-0003` (`insp-e2e-bloqueada`), la única
 * ejecución sembrada que ningún spec muta: los demás archivos la abren sólo
 * para leerla. Nunca se afirma un total, porque los specs hermanos crean
 * ejecuciones propias contra la misma base.
 */
test.describe("Inspecciones — bandeja de ejecuciones", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/inspecciones")
    await expectPageTitle(page, "Inspecciones")
  })

  test("cada ejecución muestra su cumplimiento y sus hallazgos abiertos", async ({ page }) => {
    const fila = page.getByRole("row").filter({ hasText: "INSP-E2E-0003" })
    await expect(fila).toBeVisible({ timeout: 30_000 })
    await expect(fila.getByText("Ejecutada")).toBeVisible()
    await expect(fila.getByText("Faena E2E")).toBeVisible()
    // Hallazgos abiertos y, entre paréntesis, los graves.
    await expect(fila.getByText("1 (1)")).toBeVisible()
    await expect(fila.getByText("80%")).toBeVisible()
  })

  /**
   * C-09: los KPIs se calculan sobre el universo completo, no sobre la página
   * visible, y hacen de filtro. Derivarlos de las filas presentes los volvía
   * mentira en cuanto había más de una página.
   */
  test("los KPIs acotan la bandeja a su propio universo", async ({ page }) => {
    await page.getByRole("button", { name: /Con hallazgo grave/ }).click()
    await expect(page).toHaveURL(/vista=critical/, { timeout: 15_000 })
    await expect(page.getByRole("row").filter({ hasText: "INSP-E2E-0003" })).toBeVisible({ timeout: 30_000 })
    // Planificada y sin hallazgos: no puede aparecer bajo esta vista.
    await expect(page.getByRole("row").filter({ hasText: "INSP-E2E-0001" })).toHaveCount(0)

    await page.goto("/prevencion/inspecciones?vista=pending_review")
    await expect(page.getByRole("row").filter({ hasText: "INSP-E2E-0003" })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("row").filter({ hasText: "INSP-E2E-0001" })).toHaveCount(0)
  })

  test("el filtro por estado deja su chip y se puede limpiar", async ({ page }) => {
    await page.getByLabel("Estado de la inspección").click()
    await page.getByRole("option", { name: "Planificada", exact: true }).click()

    await expect(page).toHaveURL(/estado=planned/, { timeout: 15_000 })
    await expect(page.getByRole("row").filter({ hasText: "INSP-E2E-0003" })).toHaveCount(0)
    // El chip, y no el rótulo del selector: ése muestra "Planificada" aunque no
    // quede ninguna fila, así que la aserción sería vacía.
    await expect(page.getByText("Filtros activos:")).toBeVisible()
    await expect(page.getByRole("button", { name: "Eliminar filtro Estado" })).toBeVisible()

    await page.getByRole("button", { name: "Limpiar filtros" }).click()
    await expect(page).not.toHaveURL(/estado=planned/, { timeout: 15_000 })
    await expect(page.getByRole("row").filter({ hasText: "INSP-E2E-0003" })).toBeVisible({ timeout: 30_000 })
  })

  /**
   * El buscador viaja a la URL para llegar al SQL: sin eso sólo buscaría dentro
   * de la página visible. Se ataca por query param porque el control vive en la
   * cabecera del shell, no en la pantalla.
   */
  test("el buscador acota por código, plantilla o sujeto", async ({ page }) => {
    await page.goto("/prevencion/inspecciones?q=INSP-E2E-0003")
    await expect(page.getByRole("row").filter({ hasText: "INSP-E2E-0003" })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("row").filter({ hasText: "INSP-E2E-0001" })).toHaveCount(0)

    await page.goto("/prevencion/inspecciones?q=Extintor Taller E2E")
    await expect(page.getByRole("row").filter({ hasText: "INSP-E2E-0003" })).toBeVisible({ timeout: 30_000 })

    await page.goto("/prevencion/inspecciones?q=no-existe-nada-asi")
    await expect(page.getByText("No hay inspecciones con estos filtros")).toBeVisible({ timeout: 30_000 })
  })

  test("exportar entrega el Excel de inspecciones", async ({ page }) => {
    const descarga = page.waitForEvent("download")
    await page.getByRole("link", { name: "Exportar Excel" }).click()
    expect((await descarga).suggestedFilename()).toMatch(/^inspecciones_\d{4}-\d{2}-\d{2}\.xlsx$/)
  })
})
