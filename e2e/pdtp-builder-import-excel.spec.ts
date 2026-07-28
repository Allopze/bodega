import { expect, test, type Page } from "@playwright/test"
import ExcelJS from "exceljs"
import { login } from "./helpers"

/**
 * E2E: PDTP — importación de Excel del builder (`import-excel-section.tsx`,
 * vive en la tab "Revisión") y, como consecuencia de una importación con
 * metadata de elaboración, `reconcile-declared-actor-button.tsx` en el
 * detalle del programa. Ninguno tenía e2e antes de este spec.
 *
 * El parser (`lib/services/prevention-pdtp-catalog.ts`) exige las 8 hojas
 * oficiales por nombre exacto y, en "PDTP GENERAL", el par de encabezados
 * P/E en la fila 12 para las 48 columnas semanales — si falta una sola hoja
 * o un solo par, `stagePdtpXlsxImport` rechaza el archivo completo.
 */

const OTHER_SHEETS = [
  "CPHS", "PRF Y Adm. de contrato", "Sup, JT", "PRF", "Adm. de contrato",
  "Subgerente operaciones y mant.", "Capacitación y Campañas ",
]

async function buildMinimalPdtpWorkbook(elaboratedByName?: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const general = workbook.addWorksheet("PDTP GENERAL")
  const header = general.getRow(12)
  header.getCell(1).value = "OBJETIVO"
  header.getCell(2).value = "N°"
  header.getCell(3).value = "ACTIVIDAD"
  header.getCell(4).value = "GUÍA DE EJECUCIÓN"
  header.getCell(5).value = "RESPONSABLE"
  for (let sequence = 0; sequence < 48; sequence++) {
    header.getCell(6 + sequence * 2).value = "P"
    header.getCell(7 + sequence * 2).value = "E"
  }
  const dataRow = general.getRow(13)
  dataRow.getCell(1).value = "Objetivo Importado E2E"
  dataRow.getCell(2).value = 1
  dataRow.getCell(3).value = "Actividad importada desde Excel E2E"
  dataRow.getCell(4).value = "Guía de ejecución E2E"
  dataRow.getCell(5).value = "Prevencionista"
  dataRow.getCell(6).value = 2 // planificado, mes 1 semana 1

  if (elaboratedByName) general.getCell("C113").value = elaboratedByName

  for (const name of OTHER_SHEETS) workbook.addWorksheet(name)

  return Buffer.from(await workbook.xlsx.writeBuffer())
}

async function createEmptyDraftProgram(page: Page, title: string): Promise<string> {
  await page.goto("/prevencion/pdtp/nuevo")
  await page.getByLabel("Título del programa").fill(title)
  await page.getByRole("button", { name: "Crear programa" }).click()
  await expect(page).toHaveURL(/\/prevencion\/pdtp\/[^/]+\/editar/, { timeout: 15_000 })
  return new URL(page.url()).pathname.split("/")[3]!
}

test.describe("PDTP — Builder: importación de Excel", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("analizar y aplicar un lote válido crea la actividad del catálogo", async ({ page }) => {
    await createEmptyDraftProgram(page, "Programa Import Excel Aplicar E2E")
    await page.getByRole("tab", { name: /Revisión/ }).click()

    const buffer = await buildMinimalPdtpWorkbook()
    await page.getByLabel("Seleccionar archivo").setInputFiles({
      name: "pdtp-e2e.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    })
    await page.getByRole("button", { name: "Analizar Excel" }).click()
    await expect(page.getByText(/Preview listo: pdtp-e2e\.xlsx/)).toBeVisible({ timeout: 15_000 })

    await page.getByRole("button", { name: "Aplicar lote" }).click()
    await expect(page.getByText("Lote aplicado correctamente.")).toBeVisible({ timeout: 15_000 })

    await page.getByRole("tab", { name: /Actividades/ }).click()
    await expect(page.getByText("Actividad importada desde Excel E2E")).toBeVisible()
  })

  test("cancelar un preview con motivo no modifica el programa", async ({ page }) => {
    await createEmptyDraftProgram(page, "Programa Import Excel Cancelar E2E")
    await page.getByRole("tab", { name: /Revisión/ }).click()

    const buffer = await buildMinimalPdtpWorkbook()
    await page.getByLabel("Seleccionar archivo").setInputFiles({
      name: "pdtp-e2e-cancel.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    })
    await page.getByRole("button", { name: "Analizar Excel" }).click()
    await expect(page.getByText(/Preview listo/)).toBeVisible({ timeout: 15_000 })

    await page.getByRole("button", { name: "Cancelar preview" }).click()
    await page.getByLabel("Motivo para cancelar el preview").fill("El archivo no corresponde a la versión vigente.")
    await page.getByRole("button", { name: "Confirmar cancelación" }).click()
    await expect(page.getByRole("button", { name: "Analizar Excel" })).toBeVisible({ timeout: 15_000 })

    await page.getByRole("tab", { name: /Actividades/ }).click()
    await expect(page.getByText("Sin actividades.", { exact: false })).toBeVisible()
  })

  test("reconciliar la identidad declarada por un documento importado", async ({ page }) => {
    const programId = await createEmptyDraftProgram(page, "Programa Import Excel Reconciliar E2E")
    await page.getByRole("tab", { name: /Revisión/ }).click()

    const buffer = await buildMinimalPdtpWorkbook("Prevencionista Declarado E2E")
    await page.getByLabel("Seleccionar archivo").setInputFiles({
      name: "pdtp-e2e-metadata.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    })
    await page.getByRole("button", { name: "Analizar Excel" }).click()
    await expect(page.getByText(/Preview listo/)).toBeVisible({ timeout: 15_000 })
    await page.getByRole("button", { name: "Aplicar lote" }).click()
    await expect(page.getByText("Lote aplicado correctamente.")).toBeVisible({ timeout: 15_000 })

    await page.goto(`/prevencion/pdtp/${programId}`)
    await page.getByText("Historia y referencias del documento importado").click()
    await expect(page.getByText("Prevencionista Declarado E2E")).toBeVisible()

    await page.getByRole("button", { name: "Vincular a una persona" }).click()
    const dialog = page.getByRole("dialog", { name: "Reconciliar identidad declarada" })
    await dialog.getByLabel("Motivo").fill("El nombre declarado corresponde al prevencionista de faena E2E.")
    await dialog.getByRole("button", { name: "Guardar vínculo" }).click()
    await expect(dialog).not.toBeVisible({ timeout: 15_000 })
  })
})
