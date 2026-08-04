import { expect, test, type Page } from "@playwright/test"
import ExcelJS from "exceljs"
import { clearRateLimits } from "./helpers"


test("exportes: genera Excel parseable con volumen operativo alto", async ({ page }) => {
  await login(page)

  const response = await page.request.get("/api/reportes/export?tipo=items_sin_oc")
  expect(response.status()).toBe(200)
  expect(response.headers()["content-type"]).toContain("spreadsheetml.sheet")
  expect(response.headers()["content-disposition"]).toContain("items-sin-oc.xlsx")

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(await response.body()) as never)

  const worksheet = workbook.getWorksheet("Items sin OC")
  expect(worksheet).toBeDefined()
  expect(worksheet?.getRow(1).values).toEqual([
    undefined,
    "Producto",
    "SKU",
    "Faena",
    "Solicitud",
    "Cantidad",
    "U/M",
    "Estado",
    "Fecha creación",
  ])
  expect(worksheet?.rowCount).toBeGreaterThanOrEqual(121)
  expect(worksheet?.getColumn(4).values.join(" ")).toContain("SOL-BULK-E2E-001")
})

async function login(page: Page) {
  await clearRateLimits()
  await page.goto("/login")
  await page.getByLabel("Correo electrónico").fill("admin@e2e.chome.cl")
  await page.getByLabel("Contraseña").fill("chome2026")
  await page.getByRole("button", { name: "Ingresar" }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}


/**
 * Los cuatro exportes de Reportes, abiertos como archivo (TASK-UI-015).
 *
 * Hasta ahora la suite comprobaba que la descarga respondía 200 en dos de los
 * cuatro tipos. Nadie había abierto los otros dos: un XLSX que se descarga y no
 * se parsea sólo demuestra que el servidor no falló. El criterio de la tarea
 * pide que "los cuatro exportes sigan disponibles en Excel", y eso incluye
 * encabezados y estados en lenguaje de negocio, no enums.
 */
const EXPORTES = [
  { tipo: "items_sin_oc", archivo: "items-sin-oc.xlsx", hoja: "Items sin OC", primerEncabezado: "Producto" },
  { tipo: "gasto_faena", archivo: "gasto-por-faena.xlsx", hoja: "Gasto por faena", primerEncabezado: "OC" },
  { tipo: "oc_por_estado", archivo: "oc-por-estado.xlsx", hoja: "OC por estado", primerEncabezado: "OC" },
  { tipo: "oc_cerradas_sin_factura", archivo: "oc-cerradas-sin-factura.xlsx", hoja: "OC cerradas sin factura", primerEncabezado: "Código OC" },
  { tipo: "dte_libro_compras", archivo: "dte-libro-compras.xlsx", hoja: "Libro de Compras DTE", primerEncabezado: "Tipo" },
  { tipo: "dte_conciliacion", archivo: "dte-conciliacion.xlsx", hoja: "Conciliación OC-Factura-DTE", primerEncabezado: "Tipo DTE" },
  { tipo: "dte_facturas_sin_oc", archivo: "dte-facturas-sin-oc.xlsx", hoja: "DTE sin OC", primerEncabezado: "Tipo" },
] as const

for (const exporte of EXPORTES) {
  test(`exportes: ${exporte.tipo} abre como Excel con su hoja y encabezados`, async ({ page }) => {
    await login(page)

    const response = await page.request.get(`/api/reportes/export?tipo=${exporte.tipo}`)
    expect(response.status()).toBe(200)
    expect(response.headers()["content-type"]).toContain("spreadsheetml.sheet")
    expect(response.headers()["content-disposition"]).toContain(exporte.archivo)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(await response.body()) as never)

    const worksheet = workbook.getWorksheet(exporte.hoja)
    expect(worksheet, `falta la hoja "${exporte.hoja}"`).toBeDefined()
    // `values` de ExcelJS es 1-indexado y deja `undefined` en la posición 0.
    const encabezados = (worksheet!.getRow(1).values as unknown[]).slice(1)
    expect(encabezados[0]).toBe(exporte.primerEncabezado)
    expect(encabezados.every((cell) => typeof cell === "string" && cell.length > 0)).toBe(true)
  })
}

test("exportes: la columna de estado usa lenguaje de negocio, no el enum", async ({ page }) => {
  await login(page)

  for (const tipo of ["gasto_faena", "oc_por_estado", "dte_libro_compras"]) {
    const response = await page.request.get(`/api/reportes/export?tipo=${tipo}`)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(await response.body()) as never)
    const worksheet = workbook.worksheets[0]!
    const encabezados = (worksheet.getRow(1).values as unknown[]).slice(1)
    const columna = encabezados.findIndex((cell) => cell === "Estado" || cell === "Estado SII") + 1
    expect(columna, `${tipo} no tiene columna Estado`).toBeGreaterThan(0)

    const valores = (worksheet.getColumn(columna).values as unknown[])
      .slice(2)
      .filter((cell): cell is string => typeof cell === "string")
    // Los enums de OC son snake_case en inglés; una etiqueta de negocio nunca lo es.
    const crudos = valores.filter((value) => /^[a-z]+(_[a-z]+)*$/.test(value))
    expect(crudos, `${tipo} exporta el enum crudo`).toEqual([])
  }
})

/**
 * Verifica los 3 reportes de DTE contra el fixture sembrado en setup-db.ts:
 * dte-e2e-matched (folio 900001, sin discrepancia), dte-e2e-discrepancia
 * (folio 900002, $500 de diferencia contra oc-invoice-e2e) y
 * dte-e2e-huerfana (folio 900003, sin vínculo a OC ni combustible).
 */
test("exportes: dte_conciliacion calcula la discrepancia real contra la factura de OC", async ({ page }) => {
  await login(page)

  const response = await page.request.get("/api/reportes/export?tipo=dte_conciliacion")
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(await response.body()) as never)
  const worksheet = workbook.getWorksheet("Conciliación OC-Factura-DTE")!

  const rows = worksheet.getRows(2, worksheet.rowCount - 1) ?? []
  const folioColumn = (worksheet.getRow(1).values as unknown[]).indexOf("Folio DTE")
  const discrepanciaColumn = (worksheet.getRow(1).values as unknown[]).indexOf("Discrepancia")

  const matched = rows.find((r) => r.getCell(folioColumn).value === 900001)
  const withDiscrepancy = rows.find((r) => r.getCell(folioColumn).value === 900002)

  expect(matched, "falta la fila del DTE conciliado sin discrepancia").toBeDefined()
  expect(matched!.getCell(discrepanciaColumn).value).toBe(0)
  expect(withDiscrepancy, "falta la fila del DTE con discrepancia").toBeDefined()
  expect(withDiscrepancy!.getCell(discrepanciaColumn).value).toBe(500)
})

test("exportes: dte_facturas_sin_oc solo lista el DTE huérfano, no los ya vinculados", async ({ page }) => {
  await login(page)

  const response = await page.request.get("/api/reportes/export?tipo=dte_facturas_sin_oc")
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(await response.body()) as never)
  const worksheet = workbook.getWorksheet("DTE sin OC")!

  const folioColumn = (worksheet.getRow(1).values as unknown[]).indexOf("Folio")
  const folios = worksheet.getRows(2, worksheet.rowCount - 1)?.map((r) => r.getCell(folioColumn).value) ?? []

  expect(folios).toContain(900003)
  expect(folios).not.toContain(900001)
  expect(folios).not.toContain(900002)
})
