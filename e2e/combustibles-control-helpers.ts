import { readFileSync } from "node:fs"
import path from "node:path"
import { expect, type APIResponse, type Locator, type Page } from "@playwright/test"
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
// Sin «TAE», «TCT», «CMPC» ni «Copec» en el nombre: el formulario no
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

/** Un equipo y un punto de carga distintos de los del spec de control (el de «Por revisar», por ejemplo). */
export interface PostLoadTarget {
  vehicle: { id: string; code: string; plate: string }
  pointId: string
}

export interface PostLoadOptions {
  /** Sin esto, el equipo y el punto de `combustibles-control.spec.ts`. */
  target?: PostLoadTarget
  /** Carga de otro día (hora de pared de Chile `2026-10-12T14:30` y motivo): la fecha la pone la persona, no la plataforma. */
  pastLoad?: { loadedAt: string; reason: string }
  /** Sin fotos: sólo una carga de otro día puede registrarse así. */
  withPhotos?: boolean
  liters?: number
}

/** Una carga por la API autenticada, con el mismo multipart que arma el formulario. */
export async function postLoad(page: Page, load: { reading: number; removed: string; installed: string }, options: PostLoadOptions = {}): Promise<APIResponse> {
  clientSeq += 1
  const vehicle = options.target?.vehicle ?? { id: VEHICLE_ID, code: VEHICLE_CODE, plate: VEHICLE_PLATE }
  const payload = {
    clientSubmissionId: `ctl-e2e-${Date.now()}-${clientSeq}`,
    worksiteId: WORKSITE_ID,
    loadingPointId: options.target?.pointId ?? POINT_ID,
    vehicleId: vehicle.id,
    productId: PRODUCT_ID,
    supplyMediumId: MEDIUM_ID,
    equipmentCode: vehicle.code,
    plate: vehicle.plate,
    driverWorkerId: "",
    driverName: "Conductor CTL E2E",
    supervisorWorkerId: "",
    supervisorName: "Supervisor CTL E2E",
    manualIdentity: true,
    meterType: "odometer",
    meterReading: load.reading,
    meterUnavailableReason: "",
    liters: options.liters ?? LITERS,
    removedSealNumber: load.removed,
    installedSealNumber: load.installed,
    noSealReason: "",
    notes: "",
    ...(options.pastLoad ? { pastLoad: options.pastLoad } : {}),
  }
  const file = (kind: string) => ({ name: `${kind}.png`, mimeType: "image/png", buffer: photo })
  return page.request.post("/api/combustibles/cargas", {
    multipart: {
      payload: JSON.stringify(payload),
      ...(options.withPhotos === false ? {} : {
        odometer: file("odometer"),
        liter_meter: file("liter_meter"),
        removed_seal: file("removed_seal"),
        installed_seal: file("installed_seal"),
      }),
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

/** Escapa un texto para armar una regex con él. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * La tabla «Rendimiento por equipo» de `/combustibles/consumo/rendimiento/<familia>`
 * (`EquipmentStatsTable`: la región de la tabla, no la sección que la envuelve).
 * Columnas: 0 equipo (código y patente), 1 faena, 2 modelo, 3 rendimiento y su
 * unidad, 4 su modelo, 5 su historial, 6 y 7 diferencias, 8 carga a carga, 9 aviso.
 */
export function equipmentRow(page: Page, code: string = VEHICLE_CODE) {
  return page.locator('div[role="region"][aria-label="Rendimiento por equipo"]').getByRole("row").filter({ hasText: code })
}

/**
 * «Ver datos estadísticos» (`Disclosure`, un `<details>` que monta su contenido al
 * abrirse) y, dentro, la fila del equipo en «Cifras estadísticas del rendimiento por
 * equipo». Columnas: 0 equipo, 1 tipo, 2 marca, 3 unidad, 4 cargas válidas, 5 promedio,
 * 6 desviación, 7 variación. El clic se reintenta porque uno anterior a la hidratación
 * deja el `<details>` abierto sin que React monte el contenido.
 */
export async function equipmentStatisticsRow(page: Page, code: string = VEHICLE_CODE) {
  const table = page.getByRole("region", { name: "Cifras estadísticas del rendimiento por equipo", exact: true })
  const summary = page.locator("summary").filter({ hasText: "Ver datos estadísticos" })
  await expect(async () => {
    if (!(await table.isVisible())) await summary.click({ timeout: 5_000 })
    await expect(table).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  return table.getByRole("row").filter({ hasText: code })
}

/** El texto de la celda «Rendimiento» es «10 km/L»: el promedio, un espacio y la unidad. */
export function meanCellPattern(mean: string): RegExp {
  return new RegExp(`^${escapeRegExp(mean)}\\s`)
}

/** Abre un Radix Select y elige la opción; reintenta si el clic llegó antes de hidratar. */
export async function pickSelect(page: Page, triggerId: string, option: string) {
  await expect(async () => {
    await page.locator(`#${triggerId}`).click()
    await page.getByRole("option", { name: option, exact: true }).click({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
}

/**
 * Abre la hoja de decisión de una fila de «Por revisar» (`?item=`). El clic se
 * reintenta mientras la hoja no esté abierta —uno anterior a la hidratación no
 * dispara el manejador— y se deja de pulsar en cuanto aparece: con la hoja
 * abierta el botón queda detrás del overlay y deja de resolver por rol.
 */
export async function openInboxItem(page: Page, rowButton: Locator, sheet: Locator) {
  await expect(async () => {
    if (!(await sheet.isVisible())) await rowButton.click({ timeout: 5_000 })
    await expect(sheet).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
}

/** Elige el equipo, el combustible, el medio y los sellos del formulario por pasos, hasta «Revisar y enviar». */
export interface FieldLoadFlowOptions {
  /** Pasos que la pantalla pinta antes del primero del formulario: 1 en el registro autenticado («Dónde»), 0 en el QR. */
  stepsBefore?: number
  vehicleCode?: string
  /** Una carga de otro día no exige fotos: se saltan. */
  withPhotos?: boolean
  liters?: number
}

/** Paso a paso del formulario de terreno hasta «Revisar y enviar». */
export async function fillFieldLoad(page: Page, reading: number, removed: string, installed: string, options: FieldLoadFlowOptions = {}) {
  const before = options.stepsBefore ?? 0
  const total = 6 + before
  const vehicleCode = options.vehicleCode ?? VEHICLE_CODE
  const withPhotos = options.withPhotos ?? true
  const liters = options.liters ?? LITERS
  const step = (position: number) => page.getByText(`Paso ${position + before} de ${total}`)
  const next = page.getByRole("button", { name: "Siguiente" })

  await expect(step(1)).toBeVisible({ timeout: 20_000 })
  await page.getByRole("option", { name: new RegExp(escapeRegExp(vehicleCode)) }).click()
  await expect(page.getByText(/Combustible:/)).toBeVisible()
  const medium = page.getByRole("radio", { name: MEDIUM_NAME })
  await expect(medium).toHaveAttribute("aria-checked", "false")
  await medium.click()
  await expect(medium).toHaveAttribute("aria-checked", "true")
  await next.click()

  await expect(step(2)).toBeVisible()
  await page.locator("#tae-meter-reading").fill(String(reading))
  if (withPhotos) {
    await page.locator("#tae-evidence-odometer").setInputFiles(photoPath)
    await expect(page.getByText("Repetir foto")).toHaveCount(1, { timeout: 30_000 })
  }
  await next.click()

  await expect(step(3)).toBeVisible()
  await page.locator("#tae-liters").fill(String(liters))
  if (withPhotos) {
    await page.locator("#tae-evidence-liter_meter").setInputFiles(photoPath)
    await expect(page.getByText("Repetir foto")).toHaveCount(1, { timeout: 30_000 })
  }
  await next.click()

  await expect(step(4)).toBeVisible()
  await page.locator("#tae-removed").fill(removed)
  await page.locator("#tae-installed").fill(installed)
  if (withPhotos) {
    await page.locator("#tae-evidence-removed_seal").setInputFiles(photoPath)
    await page.locator("#tae-evidence-installed_seal").setInputFiles(photoPath)
    await expect(page.getByText("Repetir foto")).toHaveCount(2, { timeout: 30_000 })
  }
  await next.click()

  await expect(step(5)).toBeVisible()
  await page.locator("#tae-driver").fill("Conductor CTL E2E")
  await page.locator("#tae-supervisor").fill("Supervisor CTL E2E")
  await next.click()

  await expect(step(6)).toBeVisible()
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

/**
 * Abre el selector «Agregar datos» («¿Qué tienes en la mano?») de la pantalla actual. El
 * botón vive en `PageHeader.actions` (TopBar en escritorio y cabecera móvil), así que se
 * busca por rol: sólo resuelve el visible. Un clic anterior a la hidratación no abre el
 * diálogo y Playwright no lo repite solo; se vuelve a pulsar sólo si no está abierto.
 */
export async function openAddDataSelector(page: Page): Promise<Locator> {
  const agregar = page.getByRole("button", { name: "Agregar datos", exact: true })
  const selector = page.getByRole("dialog", { name: "¿Qué tienes en la mano?" })
  await expect(async () => {
    if (!(await selector.isVisible())) await agregar.click({ timeout: 5_000 })
    await expect(selector).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
  return selector
}

/**
 * «Agregar datos» › «Tengo despachos de un surtidor» (`/combustibles/fuentes?agregar=surtidor`)
 * hasta la revisión del archivo. El selector abre un diálogo propio y el enlace elegido
 * deja el importador abierto sobre «Fuentes de datos».
 */
export async function openSupplyImportPreview(page: Page, file: Buffer) {
  await page.goto("/combustibles/fuentes")
  const selector = await openAddDataSelector(page)
  await selector.getByRole("link", { name: /Tengo despachos de un surtidor/ }).click()
  await expect(page).toHaveURL(/\/combustibles\/fuentes\?agregar=surtidor/)

  const dialog = page.getByRole("dialog", { name: "Importar entradas de surtidor o tarjeta" })
  await expect(dialog).toBeVisible({ timeout: 20_000 })
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

/** «1.700 L» → 1700; la cuadratura dice «—» cuando no hay movimiento, y eso se lee como cero. */
export function parseLitersOrZero(text: string): number {
  return text.trim() === "—" ? 0 : parseLiters(text)
}

/**
 * Lo que «entró» de un mandante en `/combustibles/cuadratura/mandante`: la celda
 * «Entró» de su fila en «Cuadratura por mandante» (columnas: 0 mandante, 1 entró,
 * 2 entregado directo, 3 vía estanque, 4 diferencia y %, 5 tolerancia, 6 estado).
 */
export function mandanteRowCell(page: Page, mandanteName: string, column: number) {
  return page
    .getByRole("region", { name: "Cuadratura por mandante", exact: true })
    .getByRole("row")
    .filter({ hasText: mandanteName })
    .getByRole("cell")
    .nth(column)
}

/** La fila de un medio de suministro en «Cruce por medio de suministro» (`/combustibles/cuadratura/proveedor`). */
export function mediumCrossRow(page: Page, mediumName: string) {
  return page
    .getByRole("region", { name: "Cruce por medio de suministro", exact: true })
    .getByRole("row")
    .filter({ hasText: mediumName })
}

// Estado que pasa de una prueba a la siguiente (describe.serial).
