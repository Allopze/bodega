import { test, expect } from "@playwright/test"
import ExcelJS from "exceljs"
import { login } from "./helpers"

/**
 * E2E: PDTP — Dashboard de cumplimiento, plantillas e importación/exportación.
 *
 * Covers:
 *   • Dashboard ejecutivo de cumplimiento (/prevencion/pdtp)
 *   • Listado de programas anuales (/prevencion/pdtp/programas)
 *   • Navegación a /prevencion/pdtp/plantillas
 *   • Botón de crear programa desde la página de plantillas
 */
test.describe("PDTP — Dashboard, plantillas e importación/exportación", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("el dashboard de cumplimiento en /prevencion/pdtp carga los encabezados y KPIs", async ({ page }) => {
    await page.goto("/prevencion/pdtp")

    // Page header
    await expect(page.getByRole("heading", { name: "Dashboard de Cumplimiento SG-SST" })).toBeVisible()

    // Enlace al listado de programas
    await expect(page.getByRole("link", { name: "Listado de programas" })).toBeVisible()
  })

  test("la página reubicada del listado de programas (/prevencion/pdtp/programas) carga correctamente", async ({ page }) => {
    await page.goto("/prevencion/pdtp/programas")

    // Page header del listado o redirección si hay único programa. Antes se
    // comprobaba con isVisible().catch() sin esperar — un chequeo puntual,
    // no reintentado — lo que flaqueaba bajo carga (workers concurrentes)
    // porque corría antes de que el encabezado terminara de renderizar.
    const listHeading = page.getByRole("heading", { name: /Listado de programas preventivos/ })
    const programHeading = page.getByRole("heading", { name: /Programa/ })
    await expect(listHeading.or(programHeading)).toBeVisible()
  })

  test("la página de plantillas carga correctamente", async ({ page }) => {
    await page.goto("/prevencion/pdtp/plantillas")

    // Page header
    await expect(page.getByRole("heading", { name: "Plantillas de programas preventivos" })).toBeVisible()

    // Action button to create program
    await expect(page.getByRole("link", { name: "Crear programa" })).toBeVisible()
  })

  test("el botón de crear programa desde plantillas redirige a /prevencion/pdtp/nuevo", async ({ page }) => {
    await page.goto("/prevencion/pdtp/plantillas")

    await page.getByRole("link", { name: "Crear programa" }).click()
    await expect(page).toHaveURL("/prevencion/pdtp/nuevo")
  })

  /**
   * Task 1.7: `?formato=re36` (default de la ruta) exporta el documento RE-36
   * por faena en vez de la planilla plana. Usa el fixture `pdtp-prog-e2e`
   * (año 2026, versión 1) / `ws-e2e` (código `E2E-001`, "Faena E2E"): mismo
   * fixture que `e2e/pdtp-reporte-gestion.spec.ts` y
   * `e2e/pdtp-lifecycle-approvals.spec.ts`, que no lo modifican (solo lo
   * leen), así que es seguro anclarse a sus valores aunque la suite corra en
   * orden alfabético contra una base compartida.
   */
  test("?formato=re36 descarga el documento RE-36 con la hoja del programa, el código RE-36 y totales como fórmula", async ({ page }) => {
    const response = await page.request.get(
      "/api/prevencion/pdtp/export?programId=pdtp-prog-e2e&faena=ws-e2e&formato=re36",
    )

    expect(response.status()).toBe(200)
    expect(response.headers()["content-type"]).toContain("spreadsheetml.sheet")
    // Año/versión del programa resuelto y código de la faena resuelta
    // (`pdtp-prog-e2e`: year 2026 / version 1; `ws-e2e`: code `E2E-001`), no
    // de la query string.
    expect(response.headers()["content-disposition"]).toContain("RE-36-PDTP-2026-E2E-001-v1.xlsx")

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(await response.body()) as never)

    const worksheetNames = workbook.worksheets.map((ws) => ws.name)
    // "Hoja E2E" es la única hoja propia del programa (código "s1", fixture
    // pdtp-sheet-e2e); "Desvíos" la agrega siempre el renderizador.
    expect(worksheetNames).toContain("Hoja E2E")
    expect(worksheetNames).toContain("Desvíos")

    const sheet = workbook.getWorksheet("Hoja E2E")
    expect(sheet).toBeDefined()

    // Código del documento en la cabecera (fila 1, celda F: `CÓDIGO: RE-36`,
    // el fallback de `documentCode` — el fixture no fija uno explícito).
    expect(String(sheet!.getCell("F1").value)).toContain("RE-36")
    // Identificación de faena (fila 2, celda A): `Faena: {name} ({code})`.
    expect(String(sheet!.getCell("A2").value)).toContain("Faena E2E")
    expect(String(sheet!.getCell("A2").value)).toContain("E2E-001")

    // Totales P/E como fórmula, no como texto/número calculado en el server:
    // con 1 sola actividad en la hoja, firstDataRow=16 → lastDataRow=16 →
    // totalPRow=17 (columna F: mes 1 / semana 1 / P).
    const totalPCell = sheet!.getCell("F17")
    const totalPValue = totalPCell.value
    expect(typeof totalPValue === "object" && totalPValue !== null && "formula" in totalPValue).toBe(true)
    expect((totalPValue as { formula: string }).formula).toContain("SUM(F16:F16)")
  })

  test("?formato=plano conserva la planilla plana previa a esta tarea", async ({ page }) => {
    const response = await page.request.get(
      "/api/prevencion/pdtp/export?programId=pdtp-prog-e2e&faena=ws-e2e&hoja=s1&formato=plano&year=2026",
    )

    expect(response.status()).toBe(200)
    expect(response.headers()["content-type"]).toContain("spreadsheetml.sheet")
    expect(response.headers()["content-disposition"]).toContain("pdtp-sg-sst-2026-s1.xlsx")
  })

  test("el menú del programa ofrece 'Exportar RE-36' y 'Exportar planilla plana'", async ({ page }) => {
    await page.goto("/prevencion/pdtp/pdtp-prog-e2e")
    await page.getByRole("button", { name: "Más acciones" }).click()

    // `DropdownMenuItem asChild` clona el rol "menuitem" sobre el propio `<a>`,
    // así que el locator de rol ya es el anchor: se afirma `href` directamente.
    const re36Link = page.getByRole("menuitem", { name: "Exportar RE-36" })
    const planoLink = page.getByRole("menuitem", { name: "Exportar planilla plana" })
    await expect(re36Link).toBeVisible()
    await expect(planoLink).toBeVisible()

    await expect(re36Link).toHaveAttribute("href", /formato=re36/)
    await expect(planoLink).toHaveAttribute("href", /formato=plano/)
  })
})
