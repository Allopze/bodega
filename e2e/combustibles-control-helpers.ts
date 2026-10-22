import { readFileSync } from "node:fs"
import path from "node:path"
import { expect, type APIResponse, type Page } from "@playwright/test"
import ExcelJS from "exceljs"
import postgres from "postgres"
import { textoVisible } from "./helpers"

/** Datos fijos y pasos reutilizables de `combustibles-control.spec.ts`. */

export const VEHICLE_ID = "fuel-veh-ctl-e2e"
export const VEHICLE_CODE = "CTL-E2E-1"
export const VEHICLE_PLATE = "CTLE21"
export const WORKSITE_ID = "ws-e2e"
export const WORKSITE_NAME = "Faena E2E"
export const POINT_ID = "ctl-point-e2e"
// Sin «TAE», «TCT», «CMPC», «Aramco» ni «Copec» en el nombre: el formulario no
// preselecciona ningún medio y la prueba tiene que elegirlo, como el operador.
export const POINT_NAME = "Surtidor control E2E"
export const MANDANTE_ID = "fmd-ctl-e2e"
export const MEDIUM_ID = "fsm-cmpc"
export const MEDIUM_NAME = "Surtidor CMPC"
export const PRODUCT_ID = "fuel-diesel"
export const GUIDE_REFERENCE = "CTL-E2E-GUIA-1"
export const IMPORT_FILE_NAME = "ctl-e2e-entradas.xlsx"
export const NO_FUEL_USER = "prevencion.lectura@e2e.chome.cl"

export const photoPath = path.resolve(process.cwd(), "public/tae-icon-512.png")
export const photo = readFileSync(photoPath)

/** Lecturas del odómetro. La carga N rinde (lectura N − lectura N−1) ÷ 100 L. */
export const R0 = 100_000
export const LITERS = 100
/** Δkm/L de las cinco cargas de historial (cargas 2 a 6). */
export const HISTORY_KM_PER_LITER = [10, 10.5, 9.5, 10.2, 9.8]
/** Rinde el doble del historial, pero bajo la cota física de 25 km/L: atípica, no implausible. */
export const OUTLIER_KM_PER_LITER = 20

export const twoDecimals = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 })
export const oneDecimal = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 })
export const litersText = (value: number) => `${oneDecimal.format(value)} L`
export const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length

export function databaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
  if (!url) throw new Error("E2E_DATABASE_URL es requerido")
  return url
}

export async function withSql<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(databaseUrl(), { max: 1 })
  try { return await fn(sql) } finally { await sql.end() }
}

/** Hoy en Chile, «dd-mm-aaaa» (el formato que documenta el importador). */
export function todayInChileDdMmYyyy(): string {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
  const [year, month, day] = iso.split("-")
  return `${day}-${month}-${year}`
}

/** «1.700 L» / «−300,5 L» → número. */
export function parseLiters(text: string): number {
  const cleaned = text.replace(/\s*L\s*$/, "").replace(/\./g, "").replace(",", ".").replace("−", "-").trim()
  const value = Number(cleaned)
  if (!Number.isFinite(value)) throw new Error(`No es una cifra de litros: «${text}»`)
  return value
}

let clientSeq = 0

/** Una carga por la API autenticada, con el mismo multipart que arma el formulario. */
export async function postLoad(page: Page, load: { reading: number; removed: string; installed: string }): Promise<APIResponse> {
  clientSeq += 1
  const payload = {
    clientSubmissionId: `ctl-e2e-${Date.now()}-${clientSeq}`,
    worksiteId: WORKSITE_ID,
    loadingPointId: POINT_ID,
    vehicleId: VEHICLE_ID,
    productId: PRODUCT_ID,
    supplyMediumId: MEDIUM_ID,
    equipmentCode: VEHICLE_CODE,
    plate: VEHICLE_PLATE,
    driverWorkerId: "",
    driverName: "Conductor CTL E2E",
    supervisorWorkerId: "",
    supervisorName: "Supervisor CTL E2E",
    manualIdentity: true,
    meterType: "odometer",
    meterReading: load.reading,
    meterUnavailableReason: "",
    liters: LITERS,
    removedSealNumber: load.removed,
    installedSealNumber: load.installed,
    noSealReason: "",
    notes: "",
  }
  const file = (kind: string) => ({ name: `${kind}.png`, mimeType: "image/png", buffer: photo })
  return page.request.post("/api/combustibles/cargas", {
    multipart: {
      payload: JSON.stringify(payload),
      odometer: file("odometer"),
      liter_meter: file("liter_meter"),
      removed_seal: file("removed_seal"),
      installed_seal: file("installed_seal"),
    },
  })
}

export async function expectCreated(response: APIResponse): Promise<string> {
  const body = await response.json() as { ok?: boolean; data?: { id: string; duplicate: boolean }; message?: string }
  expect(response.status(), `respuesta: ${JSON.stringify(body)}`).toBe(201)
  expect(body.ok).toBe(true)
  expect(body.data?.duplicate).toBe(false)
  return body.data!.id
}

export async function submissionRow(id: string) {
  return withSql(async (sql) => {
    const [row] = await sql<Array<{ source: string; loaded_at_source: string; seal_chain_status: string; seal_chain_expected: string | null }>>`
      select source, loaded_at_source, seal_chain_status, seal_chain_expected from fuel_tae_submissions where id = ${id}
    `
    return row
  })
}

export async function equipmentLoad(submissionId: string) {
  return withSql(async (sql) => {
    const [row] = await sql<Array<{ id: string; source: string; review_status: string; flag_reasons: string[]; performance_status: string; performance_value: string | null }>>`
      select id, source, review_status, flag_reasons, performance_status, performance_value::text
      from fuel_equipment_loads where tae_submission_id = ${submissionId}
    `
    return row
  })
}

/** La tabla «Rendimiento por equipo» (la región de la tabla, no la sección que la envuelve). */
export function equipmentRow(page: Page) {
  return page.locator('div[role="region"][aria-label="Rendimiento por equipo"]').getByRole("row").filter({ hasText: VEHICLE_CODE })
}

/** Abre un Radix Select y elige la opción; reintenta si el clic llegó antes de hidratar. */
export async function pickSelect(page: Page, triggerId: string, option: string) {
  await expect(async () => {
    await page.locator(`#${triggerId}`).click()
    await page.getByRole("option", { name: option, exact: true }).click({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
}

/** Paso a paso del formulario de terreno hasta «Revisar y enviar». */
export async function fillFieldLoad(page: Page, reading: number, removed: string, installed: string) {
  const next = page.getByRole("button", { name: "Siguiente" })
  await expect(page.getByText("Paso 1 de 6")).toBeVisible({ timeout: 20_000 })
  await page.getByRole("option", { name: new RegExp(VEHICLE_CODE) }).click()
  await expect(page.getByText(/Combustible:/)).toBeVisible()
  const medium = page.getByRole("radio", { name: MEDIUM_NAME })
  await expect(medium).toHaveAttribute("aria-checked", "false")
  await medium.click()
  await expect(medium).toHaveAttribute("aria-checked", "true")
  await next.click()

  await expect(page.getByText("Paso 2 de 6")).toBeVisible()
  await page.locator("#tae-meter-reading").fill(String(reading))
  await page.locator("#tae-evidence-odometer").setInputFiles(photoPath)
  await expect(page.getByText("Repetir foto")).toHaveCount(1, { timeout: 30_000 })
  await next.click()

  await expect(page.getByText("Paso 3 de 6")).toBeVisible()
  await page.locator("#tae-liters").fill(String(LITERS))
  await page.locator("#tae-evidence-liter_meter").setInputFiles(photoPath)
  await expect(page.getByText("Repetir foto")).toHaveCount(1, { timeout: 30_000 })
  await next.click()

  await expect(page.getByText("Paso 4 de 6")).toBeVisible()
  await page.locator("#tae-removed").fill(removed)
  await page.locator("#tae-evidence-removed_seal").setInputFiles(photoPath)
  await page.locator("#tae-installed").fill(installed)
  await page.locator("#tae-evidence-installed_seal").setInputFiles(photoPath)
  await expect(page.getByText("Repetir foto")).toHaveCount(2, { timeout: 30_000 })
  await next.click()

  await expect(page.getByText("Paso 5 de 6")).toBeVisible()
  await page.locator("#tae-driver").fill("Conductor CTL E2E")
  await page.locator("#tae-supervisor").fill("Supervisor CTL E2E")
  await next.click()

  await expect(page.getByText("Paso 6 de 6")).toBeVisible()
  await expect(textoVisible(page, removed)).toBeVisible()
  await expect(textoVisible(page, installed)).toBeVisible()
  await expect(textoVisible(page, new RegExp(`· ${MEDIUM_NAME}$`))).toBeVisible()
}

export async function buildSupplyWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Entradas")
  sheet.addRow(["Fecha", "Faena", "Litros", "Referencia"])
  sheet.addRow([todayInChileDdMmYyyy(), WORKSITE_NAME, 1000, GUIDE_REFERENCE])
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

/** Diálogo de importación de entradas hasta la revisión del archivo. */
export async function openSupplyImportPreview(page: Page, file: Buffer) {
  await page.goto("/combustibles/control/importar")
  await expect(async () => {
    await page.getByRole("button", { name: "Importar", exact: true }).click()
    await expect(page.getByRole("dialog", { name: "¿Qué quieres importar?" })).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  await page.getByRole("button", { name: /Entradas de surtidor o tarjeta/ }).click()
  const dialog = page.getByRole("dialog", { name: "Importar entradas de surtidor o tarjeta" })
  await expect(dialog).toBeVisible()
  await dialog.getByRole("combobox", { name: "Medio de suministro" }).click()
  await page.getByRole("option", { name: MEDIUM_NAME, exact: true }).click()
  await dialog.locator('input[type="file"]').setInputFiles({
    name: IMPORT_FILE_NAME,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: file,
  })
  await dialog.getByRole("button", { name: "Revisar archivo" }).click()
  const preview = page.getByRole("dialog", { name: "Revisa antes de importar" })
  await expect(preview).toBeVisible({ timeout: 30_000 })
  return preview
}

/** Cifra de la conciliación (C-02): «Entrada», «Diferencia»… */
export function flowFigure(page: Page, label: string) {
  return page.locator('section[aria-labelledby="conciliacion-title"]')
    .locator("p", { hasText: new RegExp(`^${label}$`) })
    .locator("xpath=following-sibling::p[1]")
}

// Estado que pasa de una prueba a la siguiente (describe.serial).
