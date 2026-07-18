import { test, expect, type Page } from "@playwright/test"
import ExcelJS from "exceljs"
import { login, pickCurrentMonthDate } from "./helpers"

async function selectCombobox(page: Page, index: number, option: string | RegExp) {
  await page.getByRole("combobox").nth(index).click()
  await page.getByRole("option", { name: option }).first().click()
}

test.describe("Combustibles module", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("consumption dashboard loads with KPIs and charts", async ({ page }) => {
    await page.goto("/combustibles")
    await expect(page.locator("h1").first()).toContainText("Combustibles")
    // KPI cards should be visible
    await expect(page.getByText("Total consumido")).toBeVisible()
    await expect(page.getByText("Monto total", { exact: true })).toBeVisible()
    await expect(page.getByText("Transacciones", { exact: true })).toBeVisible()
    await expect(page.getByText("Sin asociación")).toBeVisible()
    // Detail table (subordinate to the dashboard, not the main view)
    await expect(page.getByRole("link", { name: /Ver .*registros del período/ })).toBeVisible()
  })

  test("facturas dashboard (relocated invoice control) loads with KPIs and charts", async ({ page }) => {
    await page.goto("/combustibles/facturas")
    await expect(page.locator("h1").first()).toContainText("Facturas de combustible")
    await expect(page.getByText("Litros totales")).toBeVisible()
    await expect(page.getByText("Total gastado")).toBeVisible()
    await expect(page.getByText("Cargas", { exact: true }).first()).toBeVisible()
  })

  test("import consumos page loads with the wizard and history", async ({ page }) => {
    await page.goto("/combustibles/importar")
    await expect(page.locator("h1").first()).toContainText("Importar consumos")
    await expect(page.getByText("Carga manual de reportes")).toBeVisible()
    await expect(page.getByText("Historial de importaciones")).toBeVisible()
  })

  test("create a new fuel load", async ({ page }) => {
    await page.goto("/combustibles/nueva")
    await expect(page.locator("h1").first()).toContainText("Nueva carga")

    // Fill form
    await pickCurrentMonthDate(page, "Seleccionar fecha")
    await selectCombobox(page, 0, "TCT")
    await selectCombobox(page, 1, /E2E-FUEL-1/)
    await selectCombobox(page, 2, "Proveedor Combustible E2E")
    await selectCombobox(page, 3, "Faena E2E")
    await selectCombobox(page, 4, "Petróleo Diésel")
    await page.fill('input[name="receiptNumber"]', "TEST-001")
    await page.fill('input[name="liters"]', "1000")
    await page.fill('input[name="baseAmount"]', "1000000")

    // Submit
    await page.getByRole("button", { name: "Registrar carga" }).click()
    await expect(page).toHaveURL(/\/combustibles$/, { timeout: 15_000 })
  })

  test("import operational log: upload, preview, confirm and view batch detail", async ({ page }) => {
    // Genera un XLSX con los encabezados reales del "CONSOLIDADO COMBUSTIBLES
    // CHOME" (con anotaciones "(AUTOMATICO)"/"(DIGITAR)" pegadas al título),
    // para validar también el manejo de esos encabezados en el parser.
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("Hoja 1")
    sheet.addRow([
      "CODIGO\n(DIGITAR)", "PATENTE\n(AUTOMATICO)", "FECHA\n(DIGITAR)", "HORA CARGA",
      "FAENA\n(SELECCIONAR LISTA DESPLEGABLE)", "TIPO EQUIPO\n(AUTOMATICO)", "MARCA\n(AUTOMATICO)",
      "MODELO\n(AUTOMATICO)", "AÑO", "HOROMETRO / ODOMETRO", "MEDIDO POR HORA O KM",
      "LT\n(DIGITAR)", "OPERADOR\nCONDUCTOR\n(DIGITAR)", "SUPERVISOR TURNO\n(DESPLEGABLE)",
      "SUMINISTRO ENTREGADO POR:\n(DESPLEGABLE)", "RENDIMIENTO\n", "TIPO DE RENDIMIENTO", "$/lt", "Monto ($)",
    ])
    sheet.addRow([
      "E2E-01", "E2E-FUEL-1", new Date("2026-06-01"), null,
      "Faena E2E", "CAMIONETA", "Toyota", "Hilux", 2024, 32000, "KM",
      40, "E2E Operador", null, "Proveedor Combustible E2E", 12.5, "KM/LT", 981, 39240,
    ])
    const xlsxBuffer = Buffer.from(await workbook.xlsx.writeBuffer())

    await page.goto("/combustibles/importar")
    await page.getByRole("tab", { name: "Log operacional" }).click()
    await expect(page.getByText("Nueva importación de log operacional")).toBeVisible()

    await page.locator('input[type="file"]').last().setInputFiles({
      name: "combustibles-e2e-test.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: xlsxBuffer,
    })
    await page.getByRole("button", { name: "Revisar" }).click()

    await expect(page.getByText("Revisar antes de importar")).toBeVisible()
    await expect(page.getByText("Filas válidas")).toBeVisible()
    await expect(page.getByText("Con vehículo")).toBeVisible()

    await page.getByRole("button", { name: /^Confirmar/ }).click()
    await expect(page.getByText(/registros de log operacional importados exitosamente/)).toBeVisible({ timeout: 30_000 })

    const batchHref = await page.getByRole("link", { name: "Ver lote" }).getAttribute("href", { timeout: 30_000 })
    expect(batchHref).toMatch(/\/combustibles\/importar\/operaciones\//)
    await page.goto(batchHref!)
    await expect(page.locator("h1").first()).toContainText("Detalle de importación")
    await expect(page.getByText("Resumen del lote")).toBeVisible()
  })

  test("vehicles catalog page loads", async ({ page }) => {
    await page.goto("/combustibles/vehiculos")
    await expect(page).toHaveURL(/\/admin\/flota-catalogos\/vehiculos$/)
    await expect(page.locator("h1").first()).toContainText("Vehículos")
    await expect(page.getByText("Patente")).toBeVisible()
  })

  test("suppliers catalog page loads", async ({ page }) => {
    await page.goto("/combustibles/proveedores-combustible")
    await expect(page).toHaveURL(/\/admin\/flota-catalogos\/proveedores-combustible$/)
    await expect(page.locator("h1").first()).toContainText("Proveedores")
    await expect(page.getByRole("button", { name: "Ordenar por Proveedor" })).toBeVisible()
  })

  test("monthly statements page loads", async ({ page }) => {
    await page.goto("/combustibles/cuenta-corriente")
    await expect(page.locator("h1").first()).toContainText("Cuenta corriente")
  })

  test("reports page loads with tabs", async ({ page }) => {
    await page.goto("/combustibles/reportes")
    await expect(page.locator("h1").first()).toContainText("Reportes")
    await expect(page.getByRole("tab", { name: "Semanal" })).toBeVisible()
    await expect(page.getByRole("tab", { name: "Mensual" })).toBeVisible()
  })

  test("invoice import modal opens from facturas dashboard", async ({ page }) => {
    await page.goto("/combustibles/facturas")
    await page.getByRole("button", { name: "Importar Excel" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText("Importar cargas desde Excel")).toBeVisible()
    await expect(dialog.getByText("Subir archivo")).toBeVisible()
    await expect(dialog.getByText("Revisar datos")).toBeVisible()
    await expect(dialog.getByText("Completado")).toBeVisible()
  })
})
