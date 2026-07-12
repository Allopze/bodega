import { withBrowserContext } from "@/lib/pdf/browser-pool"
import type { Page } from "playwright"

const PORTAL = "https://tctcliente.copec.cl/Login.aspx"
const MAX_BYTES = 5 * 1024 * 1024

export type CopecCardType = "TCT" | "TAE"

export interface CopecReportRequest {
  cardType: CopecCardType
  from: string
  to: string
}

export interface CopecDownloadedReport {
  buffer: Buffer
  fileName: string
  contentType: string
}

export type CopecReportDownloadResult =
  | { cardType: CopecCardType; report: CopecDownloadedReport; unavailable: false }
  | { cardType: CopecCardType; unavailable: true }

/** El portal no genera un archivo para todos los períodos/tarjetas. Este caso
 * es recuperable durante una sincronización histórica, a diferencia de una
 * falla de credenciales o de conectividad. */
export class CopecReportUnavailableError extends Error {
  constructor(from: string, to: string, cardType: CopecCardType) {
    super(`Copec no entregó un archivo ${cardType} para el período ${from} a ${to}`)
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

function assertDate(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} debe tener formato YYYY-MM-DD`)
}

function dateForCopec(value: string): string {
  const [year, month, day] = value.split("-")
  return `${day}/${month}/${year}`
}

async function downloadReportFromPage(page: Page, request: CopecReportRequest): Promise<CopecDownloadedReport> {
  const card = page.locator('input[id$="RcbxTipoProducto_Input"]')
  await card.click()
  const option = page.getByText(request.cardType, { exact: true }).last()
  if (await option.count()) await option.click()

  await page.locator('input[id$="FechaInicioPatente_dateInput"]').fill(dateForCopec(request.from))
  await page.locator('input[id$="FechaFinPatente_dateInput"]').fill(dateForCopec(request.to))

  // Start listening before the click so a fast response cannot race the event.
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 }).catch(() => null)
  await page.locator("#Cph1_LinkBtnBuscar").click({ noWaitAfter: true })
  const download = await downloadPromise
  if (!download) throw new CopecReportUnavailableError(request.from, request.to, request.cardType)

  const buffer = await download.createReadStream().then(async (stream) => {
    if (!stream) throw new Error("Copec entregó una descarga vacía")
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of stream) {
      const data = Buffer.from(chunk)
      size += data.length
      if (size > MAX_BYTES) throw new Error("El reporte de Copec supera el límite de 5 MB")
      chunks.push(data)
    }
    return Buffer.concat(chunks)
  })

  return {
    buffer,
    fileName: download.suggestedFilename() || `copec-${request.cardType}-${request.from}-${request.to}.xlsx`,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }
}

/**
 * Descarga varios reportes dentro de una misma sesión autenticada de Copec.
 * Las ausencias de archivo siguen siendo recuperables por tipo de tarjeta;
 * cualquier otro fallo aborta el período para conservar el cursor reanudable.
 */
export async function downloadCopecReports(requests: CopecReportRequest[]): Promise<CopecReportDownloadResult[]> {
  for (const request of requests) {
    assertDate(request.from, "Fecha desde")
    assertDate(request.to, "Fecha hasta")
    if (request.from > request.to) throw new Error("La fecha desde no puede ser posterior a la fecha hasta")
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

    // The portal's menu performs an ASP.NET postback; direct navigation loses its session.
    await page.locator(".rmRootGroup > .rmItem").filter({ hasText: /Informes/ }).first().hover()
    await page.locator('a[title="Consumos Por Patente"]').filter({ visible: true }).first().click({ noWaitAfter: true })
    await page.waitForURL(/AdmInfConsumosPorPatente\.aspx/)

    const results: CopecReportDownloadResult[] = []
    for (const request of requests) {
      try {
        results.push({ cardType: request.cardType, report: await downloadReportFromPage(page, request), unavailable: false })
      } catch (error) {
        if (!isCopecReportUnavailableError(error)) throw error
        results.push({ cardType: request.cardType, unavailable: true })
      }
    }
    return results
  })
}
