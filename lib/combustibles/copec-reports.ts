import { withBrowserContext } from "@/lib/pdf/browser-pool"
import type { APIResponse, Locator, Page, Route } from "playwright"

const PORTAL = "https://tctcliente.copec.cl/Login.aspx"
const MAX_BYTES = 25 * 1024 * 1024

export type CopecProduct = "diesel" | "bluemax"

/** Los dos canales viven en la MISMA pantalla del portal y sólo se distinguen por
 *  el combo "Tipo Producto":
 *  - TCT: el equipo carga con tarjeta en estación de servicio (consumo).
 *  - TAE: la vasija propia (camión/camioneta estanque) carga en estación para
 *    después repartir en faena (recepción del ciclo). */
export type CopecChannel = "TCT" | "TAE"

export interface CopecReportRequest {
  product: CopecProduct
  from: string
  to: string
}

export interface CopecDownloadedReport {
  buffer: Buffer
  fileName: string
  contentType: string
}

export type CopecReportDownloadResult =
  | { product: CopecProduct; report: CopecDownloadedReport; unavailable: false }
  | { product: CopecProduct; unavailable: true }

const PRODUCT_RADIO: Record<CopecProduct, string> = {
  diesel: "#Cph1_RbTipoProductoPatPatentes_0",
  bluemax: "#Cph1_RbTipoProductoPatPatentes_1",
}

const PRODUCT_LABEL: Record<CopecProduct, string> = {
  diesel: "Diesel",
  bluemax: "BlueMax",
}

const MONTH_LABELS = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sept.", "oct.", "nov.", "dic."] as const

/** El portal no genera un archivo para todos los meses/productos. Este caso es
 * recuperable durante una sincronización histórica, a diferencia de una falla
 * de credenciales, navegación o conectividad. */
export class CopecReportUnavailableError extends Error {
  constructor(from: string, to: string, product: CopecProduct) {
    super(`Copec no entregó un detalle ${PRODUCT_LABEL[product]} para el mes ${from} a ${to}`)
    this.name = "CopecReportUnavailableError"
  }
}

export function isCopecReportUnavailableError(error: unknown): error is CopecReportUnavailableError {
  return error instanceof CopecReportUnavailableError
}

function env(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Falta configurar ${name} en el servidor`)
  return value
}

/**
 * Si el servidor tiene con qué entrar al portal, y si el cron tiene permiso.
 *
 * Existe para que el cron distinga "nadie configuró esto todavía" de "la
 * sincronización falló": sin credenciales, `env()` lanzaba dentro de la corrida
 * y la ruta reportaba `failed`, o sea una alerta diaria por una integración que
 * simplemente no está en uso. Aramco ya hacía esta distinción con
 * `readAramcoConfig`; Copec no la tenía.
 *
 * `COPEC_SYNC_ENABLED` sólo apaga si vale exactamente `"false"`: el default es
 * seguir corriendo, para no apagar la integración de nadie por omisión.
 */
export function copecSyncAvailability(): { hasCredentials: boolean; syncEnabled: boolean } {
  return {
    hasCredentials: Boolean(process.env.COPEC_USERNAME?.trim() && process.env.COPEC_PASSWORD?.trim()),
    syncEnabled: process.env.COPEC_SYNC_ENABLED?.trim() !== "false",
  }
}

function assertDate(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} debe tener formato YYYY-MM-DD`)
}

async function chooseComboOption(page: Page, input: Locator, label: string) {
  if (await input.inputValue() === label) return
  await input.click()
  await page.getByText(label, { exact: true }).filter({ visible: true }).last().click()
  await page.waitForLoadState("networkidle").catch(() => {})
}

async function selectMonth(page: Page, from: string) {
  const year = Number(from.slice(0, 4))
  const monthIndex = Number(from.slice(5, 7)) - 1
  const monthLabel = MONTH_LABELS[monthIndex]
  if (!monthLabel || !Number.isInteger(year)) throw new Error(`Mes Copec inválido: ${from}`)

  await page.locator('a[id$="PeriodoIni_popupButton"]').click()
  const view = page.locator('[id$="PeriodoIni_MonthYearTableViewID"]')
  await view.waitFor({ state: "visible" })

  let yearCell = view.locator(`#rcMView_${year}`)
  for (let attempt = 0; attempt < 12 && await yearCell.count() === 0; attempt++) {
    const visibleYears = await view.locator('td[id^="rcMView_"]').evaluateAll((cells) =>
      cells.map((cell) => Number(cell.textContent?.trim())).filter((value) => Number.isInteger(value) && value > 1900),
    )
    if (!visibleYears.length) throw new Error("Copec no mostró los años disponibles para el período")
    const control = year < Math.min(...visibleYears)
      ? page.locator('a[id$="_NavigationPrevLink"]')
      : page.locator('a[id$="_NavigationNextLink"]')
    await control.click()
    yearCell = view.locator(`#rcMView_${year}`)
  }

  if (await yearCell.count() === 0 || await yearCell.getAttribute("class") === "rcDisabled") {
    throw new Error(`Copec no permite consultar el año ${year}`)
  }

  await view.getByText(monthLabel, { exact: true }).click()
  await yearCell.click()
  await page.locator("#rcMView_OK").click()
  await page.waitForLoadState("networkidle").catch(() => {})
}

async function downloadReportFromPage(page: Page, request: CopecReportRequest, channel: CopecChannel): Promise<CopecDownloadedReport> {
  await selectMonth(page, request.from)

  // El portal deshabilita el radio del producto que la cuenta no tuvo en el mes
  // consultado. `.check()` se quedaba esperando "enabled" hasta agotar el timeout
  // y su TimeoutError -con el call log entero- cortaba el barrido histórico
  // completo: es el mismo caso recuperable que un mes sin archivo. El timeout
  // corto absorbe además el rato en que el postback de Telerik lo deshabilita.
  const radio = page.locator(PRODUCT_RADIO[request.product])
  try {
    await radio.check({ timeout: 10_000 })
  } catch (error) {
    if (!(await radio.isDisabled().catch(() => false))) throw error
    throw new CopecReportUnavailableError(request.from, request.to, request.product)
  }

  await page.locator("#Cph1_LinkBtnBuscarPatentes").click()
  const exportButton = page.locator("#Cph1_LinkBtnExportarXlsPatentes")
  try {
    await exportButton.waitFor({ state: "visible", timeout: 30_000 })
  } catch {
    throw new CopecReportUnavailableError(request.from, request.to, request.product)
  }

  const downloadType = page.locator('input[id$="RcbxTipoDescargaPatente_Input"]')
  await chooseComboOption(page, downloadType, "Descargar Detalle")
  await exportButton.waitFor({ state: "visible" })

  // La respuesta binaria del detalle cierra Chromium antes de emitir el evento
  // download. Interceptamos el postback exacto generado por Telerik, lo repetimos
  // con el request context que comparte cookies y abortamos solo la navegación.
  let resolveResponse: (response: APIResponse) => void = () => {}
  let rejectResponse: (error: unknown) => void = () => {}
  const responsePromise = new Promise<APIResponse>((resolve, reject) => {
    resolveResponse = resolve
    rejectResponse = reject
  })
  const exportRoute = async (route: Route) => {
    const browserRequest = route.request()
    if (browserRequest.method() !== "POST" || !browserRequest.postData()?.includes("LinkBtnExportarXlsPatentes")) {
      await route.continue()
      return
    }
    try {
      resolveResponse(await page.request.fetch(browserRequest, { timeout: 60_000 }))
    } catch (error) {
      rejectResponse(error)
    } finally {
      await route.abort("aborted").catch(() => {})
    }
  }

  await page.route("**/AdmInfConsumosAgrupado.aspx", exportRoute)
  let response: APIResponse
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    await exportButton.click({ noWaitAfter: true })
    response = await Promise.race([
      responsePromise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Copec demoró demasiado en generar el detalle mensual")), 60_000)
      }),
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
    await page.unroute("**/AdmInfConsumosAgrupado.aspx", exportRoute)
  }
  if (!response.ok()) throw new Error(`Copec rechazó la exportación del detalle (${response.status()})`)
  const buffer = await response.body()
  if (!buffer.length) throw new Error("Copec entregó una descarga vacía")
  if (buffer.length > MAX_BYTES) throw new Error("El detalle mensual de Copec supera el límite de 25 MB")
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error("Copec respondió sin un archivo Excel válido al exportar el detalle")
  }

  const disposition = response.headers()["content-disposition"] ?? ""
  const encodedFileName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  const plainFileName = disposition.match(/filename="?([^";]+)"?/i)?.[1]
  const fileName = encodedFileName
    ? decodeURIComponent(encodedFileName)
    : plainFileName ?? `copec-${channel.toLowerCase()}-${request.product}-${request.from.slice(0, 7)}.xlsx`

  return {
    buffer,
    fileName,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }
}

/**
 * Sigue el recorrido visible del portal: Informes -> Informes de Consumos ->
 * mes -> producto -> Buscar -> Descargar Detalle -> Excel. Todos los productos
 * del mes reutilizan una única sesión TCT autenticada.
 */
export async function downloadCopecReports(requests: CopecReportRequest[], channel: CopecChannel = "TCT"): Promise<CopecReportDownloadResult[]> {
  for (const request of requests) {
    assertDate(request.from, "Fecha desde")
    assertDate(request.to, "Fecha hasta")
    if (request.from > request.to) throw new Error("La fecha desde no puede ser posterior a la fecha hasta")
    if (!request.from.endsWith("-01")) throw new Error("El portal Copec solo permite consultar meses calendario completos")
  }
  if (!requests.length) return []

  const username = env("COPEC_USERNAME")
  const password = env("COPEC_PASSWORD")

  return withBrowserContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } }, async (context) => {
    const page = await context.newPage()
    page.setDefaultTimeout(20_000)
    await page.goto(PORTAL, { waitUntil: "domcontentloaded" })
    await page.locator("#TxbUsuario").fill(username)
    await page.locator("#TxbClave").fill(password)
    await page.locator("#BtnIngresar").click()
    await page.waitForURL(/AdmCteInicio\.aspx/)

    await page.locator(".rmRootGroup > .rmItem").filter({ hasText: /Informes/ }).first().hover()
    await page.locator('a[title="Informes de Consumos"]').filter({ visible: true }).first().click({ noWaitAfter: true })
    await page.waitForURL(/AdmInfConsumosAgrupado\.aspx/)

    await chooseComboOption(page, page.locator('input[id$="RcbxTipoProducto_Input"]'), channel)
    await chooseComboOption(page, page.locator('input[id$="RcbxTipoInforme_Input"]'), "Por Patente / Asignación")

    const results: CopecReportDownloadResult[] = []
    for (const request of requests) {
      try {
        results.push({ product: request.product, report: await downloadReportFromPage(page, request, channel), unavailable: false })
      } catch (error) {
        if (!isCopecReportUnavailableError(error)) throw error
        results.push({ product: request.product, unavailable: true })
      }
    }
    return results
  })
}
