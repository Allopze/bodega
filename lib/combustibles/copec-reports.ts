import { openBrowserPage, withIsolatedBrowserContext } from "@/lib/pdf/browser-pool"
import type { APIResponse, Locator, Page, Route } from "playwright"
import { CopecOtpTimeoutError, openCopecOtpMailbox, readCopecOtpConfig, waitForCopecOtp, type CopecOtpMailbox } from "@/lib/combustibles/copec-otp"

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
  | { product: CopecProduct; unavailable: true; reason: CopecUnavailableReason }
  | { product: CopecProduct; unavailable: false; failure: { kind: CopecReportFailureKind; message: string } }

/** `mfa_*`: el código de verificación por correo (no llegó, la casilla no responde o Copec lo rechazó). */
export type CopecReportFailureKind = "session_expired" | "mfa_mailbox" | "mfa_timeout" | "mfa_rejected" | "selector_changed" | "provider_limit" | "provider_rejected" | "network" | "invalid_file" | "report_unavailable"

export class CopecReportFailure extends Error {
  constructor(readonly kind: CopecReportFailureKind, message: string) {
    super(message)
    this.name = "CopecReportFailure"
  }
}

/**
 * Copec no terminó de generar el informe a tiempo. Es una falla de red para el
 * operador, pero NO se reintenta: cada intento espera hasta `EXPORT_FETCH_TIMEOUT_MS`,
 * y repetir esa espera no cabe en el plazo de la exportación ni en el del cron.
 */
export class CopecReportTimeoutFailure extends CopecReportFailure {
  constructor(message: string) {
    super("network", message)
    this.name = "CopecReportTimeoutFailure"
  }
}

export function isRetryableCopecFailure(error: unknown): boolean {
  return error instanceof CopecReportFailure && error.kind === "network" && !(error instanceof CopecReportTimeoutFailure)
}

/** Lo que tarda Copec en responder una exportación, por intento. */
const EXPORT_FETCH_TIMEOUT_MS = 60_000
/** Plazo total de la exportación: un intento lento más un reintento por una falla rápida (conexión cortada, 5xx). */
const EXPORT_DEADLINE_MS = 75_000

/**
 * Corta la espera de la exportación con una falla TIPADA. Antes el plazo vencía
 * con un `Error` plano que nadie clasificaba: subía por encima de
 * `downloadCopecChannel` y abortaba el período completo, canal TAE incluido.
 */
export async function withCopecExportDeadline<T>(operation: Promise<T>, ms = EXPORT_DEADLINE_MS): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new CopecReportTimeoutFailure("Copec demoró demasiado en generar el detalle mensual.")), ms)
      }),
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

/** At most one retry; auth, selector, provider-limit and file errors fail immediately. */
export async function retryCopecRequest<T>(
  operation: () => Promise<T>,
  isRetryable: (error: unknown) => boolean = isRetryableCopecFailure,
  wait: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 750)),
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (attempt === 1 || !isRetryable(error)) throw error
      await wait()
    }
  }
  throw new Error("No fue posible completar la descarga Copec")
}

const PRODUCT_RADIO: Record<CopecProduct, string> = {
  diesel: "#Cph1_RbTipoProductoPatPatentes_0",
  bluemax: "#Cph1_RbTipoProductoPatPatentes_1",
}

const PRODUCT_LABEL: Record<CopecProduct, string> = {
  diesel: "Diesel",
  bluemax: "BlueMax",
}

const MONTH_LABELS = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sept.", "oct.", "nov.", "dic."] as const

/**
 * Por qué el portal no entregó un detalle. Los dos casos no pesan lo mismo:
 * - `product_disabled`: el portal deshabilita el producto que la cuenta no tuvo
 *   en el mes. Es la respuesta de Copec de que ese mes no hubo consumo, y en un
 *   mes cerrado basta para darlo por vacío (`importCopecPeriod`).
 * - `no_results`: la búsqueda no mostró el botón de exportar a tiempo. Puede
 *   ser un mes sin datos o un portal lento: no prueba nada.
 */
export type CopecUnavailableReason = "product_disabled" | "no_results"

/** El portal no genera un archivo para todos los meses/productos. Este caso es
 * recuperable durante una sincronización histórica, a diferencia de una falla
 * de credenciales, navegación o conectividad. */
export class CopecReportUnavailableError extends CopecReportFailure {
  constructor(from: string, to: string, product: CopecProduct, readonly reason: CopecUnavailableReason = "no_results") {
    super("report_unavailable", `Copec no entregó un detalle ${PRODUCT_LABEL[product]} para el mes ${from} a ${to}`)
    this.name = "CopecReportUnavailableError"
  }
}

export function isCopecReportUnavailableError(error: unknown): error is CopecReportUnavailableError {
  return error instanceof CopecReportUnavailableError
}

function isTransientNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as NodeJS.ErrnoException).code
  return ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ERR_SOCKET_CLOSED"].includes(code ?? "")
}

function isRequestTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError"
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
    throw new CopecReportUnavailableError(request.from, request.to, request.product, "product_disabled")
  }

  await page.locator("#Cph1_LinkBtnBuscarPatentes").click()
  const exportButton = page.locator("#Cph1_LinkBtnExportarXlsPatentes")
  try {
    await exportButton.waitFor({ state: "visible", timeout: 30_000 })
  } catch {
    throw new CopecReportUnavailableError(request.from, request.to, request.product, "no_results")
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
      const response = await retryCopecRequest(async () => {
        let result: APIResponse
        try {
          result = await page.request.fetch(browserRequest, { timeout: EXPORT_FETCH_TIMEOUT_MS })
        } catch (error) {
          if (isRequestTimeout(error)) throw new CopecReportTimeoutFailure("Copec demoró demasiado en generar el detalle mensual.")
          if (isTransientNetworkFailure(error)) throw new CopecReportFailure("network", "Falla temporal de red al descargar el informe Copec.")
          throw error
        }
        if (result.status() === 429) throw new CopecReportFailure("provider_limit", "Copec limitó temporalmente las descargas; espera antes de reintentar.")
        if (result.status() === 401 || result.status() === 403) throw new CopecReportFailure("session_expired", "La sesión de Copec expiró o no tiene acceso al informe.")
        if (result.status() >= 500) {
          await result.dispose().catch(() => {})
          throw new CopecReportFailure("network", "Copec está temporalmente fuera de servicio.")
        }
        return result
      })
      resolveResponse(response)
    } catch (error) {
      rejectResponse(isTransientNetworkFailure(error)
        ? new CopecReportFailure("network", "Falla de red al descargar el informe Copec.")
        : error)
    } finally {
      await route.abort("aborted").catch(() => {})
    }
  }

  await page.route("**/AdmInfConsumosAgrupado.aspx", exportRoute)
  let response: APIResponse
  try {
    await exportButton.click({ noWaitAfter: true })
    response = await withCopecExportDeadline(responsePromise)
  } finally {
    await page.unroute("**/AdmInfConsumosAgrupado.aspx", exportRoute)
  }
  if (!response.ok()) throw new CopecReportFailure("provider_rejected", `Copec rechazó la exportación del detalle (${response.status()}).`)
  const buffer = await response.body()
  if (!buffer.length) throw new CopecReportFailure("invalid_file", "Copec entregó una descarga vacía.")
  if (buffer.length > MAX_BYTES) throw new CopecReportFailure("invalid_file", "El detalle mensual Copec supera el máximo permitido de 25 MB.")
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new CopecReportFailure("invalid_file", "Copec respondió sin un archivo Excel válido al exportar el detalle.")
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

/** Falla de un producto como dato, o `null` si no es una falla Copec conocida y debe propagarse. */
function classifyProductFailure(error: unknown): { kind: CopecReportFailureKind; message: string } | null {
  if (error instanceof CopecReportFailure) return { kind: error.kind, message: error.message }
  if (isTransientNetworkFailure(error)) return { kind: "network", message: "Falla de red al consultar este producto en Copec." }
  if (isRequestTimeout(error)) return { kind: "selector_changed", message: "Copec no mostró el control esperado para este producto." }
  return null
}

/** Fallas de acceso: repetir el login no las arregla y cada intento le cuesta a Copec un correo con código. */
const LOGIN_FAILURES = new Set<CopecReportFailureKind>(["session_expired", "mfa_mailbox", "mfa_timeout", "mfa_rejected"])

/**
 * Tras una falla de acceso no se vuelve a intentar por un rato. Sin esto, un
 * código que no llega se reintentaba en TAE, en cada producto y en cada mes del
 * barrido: un correo por intento y ninguna sesión.
 */
const LOGIN_BACKOFF_MS = 5 * 60_000
let loginBlocked: { until: number; failure: CopecReportFailure } | null = null

/** Sólo para tests: el freno de login es por proceso. */
export function _resetCopecSessionForTesting(): void {
  loginBlocked = null
}

/** Primer camino que llega: inicio (sin código) o el cuadro de verificación. `null` si ninguno. */
async function loginOutcome(page: Page): Promise<"home" | "otp" | null> {
  return Promise.any([
    page.waitForURL(/AdmCteInicio\.aspx/).then(() => "home" as const),
    page.locator("#TxbOtpCodigo").waitFor({ state: "visible" }).then(() => "otp" as const),
  ]).catch(() => null)
}

/**
 * Resuelve el cuadro "Verificación adicional": lee el código de la casilla de
 * la plataforma (ver `copec-otp.ts`) y lo valida.
 *
 * Ningún error de este tramo sale con el mensaje de Playwright: su call log
 * incluye los argumentos de `fill`, es decir, el código. Todo se convierte en
 * una `CopecReportFailure` con texto propio.
 */
async function completeOtpChallenge(page: Page, requestedAt: Date): Promise<void> {
  const config = readCopecOtpConfig()
  if (!config) {
    throw new CopecReportFailure("mfa_mailbox", "Copec pide un código de verificación por correo y faltan las variables COPEC_OTP_IMAP_* en el servidor.")
  }
  let code: string
  let mailbox: CopecOtpMailbox | undefined
  try {
    mailbox = await openCopecOtpMailbox(config)
    code = await waitForCopecOtp(mailbox, requestedAt)
  } catch (error) {
    if (error instanceof CopecOtpTimeoutError) throw new CopecReportFailure("mfa_timeout", error.message)
    throw new CopecReportFailure("mfa_mailbox", "No fue posible leer el correo de la plataforma para obtener el código de verificación de Copec.")
  } finally {
    await mailbox?.close()
  }
  try {
    // El campo nace `readonly` y el portal lo habilita en el mousedown (es su
    // defensa contra el autocompletado): sin el clic, `fill` espera para siempre.
    await page.locator("#TxbOtpCodigo").click()
    await page.locator("#TxbOtpCodigo").fill(code, { timeout: 5_000 })
    await page.locator("#BtnValidarOtp").click()
  } catch {
    throw new CopecReportFailure("selector_changed", "Copec cambió el cuadro de verificación del acceso.")
  }
  const landed = await page.waitForURL(/AdmCteInicio\.aspx/).then(() => true, () => false)
  if (!landed) throw new CopecReportFailure("mfa_rejected", "Copec no aceptó el código de verificación leído del correo.")
}

async function login(page: Page, username: string, password: string): Promise<void> {
  if (loginBlocked && loginBlocked.until > Date.now()) throw loginBlocked.failure
  try {
    await page.goto(PORTAL, { waitUntil: "domcontentloaded" })
    await page.locator("#TxbUsuario").fill(username)
    await page.locator("#TxbClave").fill(password)
    // Antes del clic: el correo con el código no puede ser anterior a este instante.
    const requestedAt = new Date()
    await page.locator("#BtnIngresar").click()
    const outcome = await loginOutcome(page)
    if (outcome === "otp") await completeOtpChallenge(page, requestedAt)
    else if (outcome !== "home") {
      if (/Login\.aspx/i.test(page.url())) {
        throw new CopecReportFailure("session_expired", "Copec no aceptó la sesión o las credenciales configuradas.")
      }
      throw new CopecReportFailure("selector_changed", "Copec no mostró la página esperada después del acceso.")
    }
    loginBlocked = null
  } catch (error) {
    if (error instanceof CopecReportFailure && LOGIN_FAILURES.has(error.kind)) {
      loginBlocked = { until: Date.now() + LOGIN_BACKOFF_MS, failure: error }
    }
    throw error
  }
}

/** Abre "Informes de Consumos" desde el menú del portal, en la página actual. */
async function openReportsFromMenu(page: Page): Promise<void> {
  await page.locator(".rmRootGroup > .rmItem").filter({ hasText: /Informes/ }).first().hover()
  await page.locator('a[title="Informes de Consumos"]').filter({ visible: true }).first().click({ noWaitAfter: true })
  await page.waitForURL(/AdmInfConsumosAgrupado\.aspx/)
}

function classifyDownloadError(error: unknown): unknown {
  if (error instanceof CopecReportFailure) return error
  if (isTransientNetworkFailure(error)) return new CopecReportFailure("network", "No fue posible conectar con Copec por una falla de red.")
  if (isRequestTimeout(error)) return new CopecReportFailure("selector_changed", "El portal Copec no mostró un control esperado dentro del tiempo límite.")
  return error
}

/** Una sesión del portal, compartida por todas las descargas de una corrida. */
export interface CopecPortalSession {
  download(requests: CopecReportRequest[], channel: CopecChannel): Promise<CopecReportDownloadResult[]>
}

/**
 * Abre UNA página del portal para toda la corrida: TCT y TAE de todos los meses
 * pasan por ella, cambiando el combo "Tipo Producto".
 *
 * Por qué una sola página y no una por descarga: desde 2026-10 cada login
 * cuesta un correo con código, y el portal cierra la sesión ante cualquier
 * navegación por URL —un `goto` a una página interna, una recarga, una pestaña
 * nueva—, aunque las cookies sigan siendo válidas (verificado contra el portal
 * el 2026-10-21). Guardar cookies entre contextos no sirve; la sesión sólo
 * sobrevive navegando con los menús y postbacks dentro de la misma página.
 *
 * El login es perezoso: si la corrida no descarga nada, no se entra al portal.
 */
export async function withCopecPortalSession<T>(run: (session: CopecPortalSession) => Promise<T>): Promise<T> {
  return withIsolatedBrowserContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } }, async (context) => {
    let page: Page | null = null
    /** Canal ya elegido en los combos de la página; `null` obliga a elegirlo de nuevo. */
    let selectedChannel: CopecChannel | null = null

    const ensureReportsPage = async (channel: CopecChannel): Promise<Page> => {
      if (!page) {
        const fresh = await openBrowserPage(context, "No fue posible abrir el navegador para consultar Copec. La sincronización se detuvo.")
        fresh.setDefaultTimeout(20_000)
        try {
          await login(fresh, env("COPEC_USERNAME"), env("COPEC_PASSWORD"))
          await openReportsFromMenu(fresh)
        } catch (error) {
          await fresh.close().catch(() => {})
          throw error
        }
        page = fresh
        selectedChannel = null
      }
      if (selectedChannel !== channel) {
        selectedChannel = null
        await chooseComboOption(page, page.locator('input[id$="RcbxTipoProducto_Input"]'), channel)
        await chooseComboOption(page, page.locator('input[id$="RcbxTipoInforme_Input"]'), "Por Patente / Asignación")
        selectedChannel = channel
      }
      return page
    }

    /**
     * Deja la página en un estado conocido después de una falla: un popup de
     * mes abierto, un postback de Telerik a medias, la ruta de exportación
     * interceptada. Primero por el menú (no cuesta login); si la sesión murió o
     * el menú tampoco responde, se descarta la página y la próxima descarga
     * vuelve a entrar.
     */
    const resetReportsPage = async (): Promise<void> => {
      selectedChannel = null
      if (!page) return
      const current: Page = page
      const recovered = await (async () => {
        await current.keyboard.press("Escape").catch(() => {})
        await openReportsFromMenu(current)
        return !/Login\.aspx/i.test(current.url())
      })().catch(() => false)
      if (!recovered) {
        await current.close().catch(() => {})
        page = null
      }
    }

    const session: CopecPortalSession = {
      async download(requests, channel) {
        for (const request of requests) {
          assertDate(request.from, "Fecha desde")
          assertDate(request.to, "Fecha hasta")
          if (request.from > request.to) throw new Error("La fecha desde no puede ser posterior a la fecha hasta")
          if (!request.from.endsWith("-01")) throw new Error("El portal Copec solo permite consultar meses calendario completos")
        }
        if (!requests.length) return []

        try {
          let reportsPage = await ensureReportsPage(channel)
          const results: CopecReportDownloadResult[] = []
          // Una falla que no sea "no disponible" deja la página en un estado que
          // no conocemos, y el producto siguiente fallaba en cascada con un
          // `selector_changed` que no era suyo. Antes de seguir se restablece la
          // página. Una falla de ACCESO al restablecerla corta el canal —otro
          // intento es otro correo con código—; cualquier otra se registra en ese
          // producto y se reintenta en el siguiente.
          let needsReset = false
          for (const [index, request] of requests.entries()) {
            if (needsReset) {
              try {
                await resetReportsPage()
                reportsPage = await ensureReportsPage(channel)
                needsReset = false
              } catch (error) {
                const failure = classifyProductFailure(error)
                if (!failure) throw error
                if (LOGIN_FAILURES.has(failure.kind)) {
                  for (const remaining of requests.slice(index)) results.push({ product: remaining.product, unavailable: false, failure })
                  break
                }
                results.push({ product: request.product, unavailable: false, failure })
                continue
              }
            }
            try {
              results.push({ product: request.product, report: await downloadReportFromPage(reportsPage, request, channel), unavailable: false })
            } catch (error) {
              if (isCopecReportUnavailableError(error)) {
                results.push({ product: request.product, unavailable: true, reason: error.reason })
                continue
              }
              const failure = classifyProductFailure(error)
              if (!failure) throw error
              results.push({ product: request.product, unavailable: false, failure })
              needsReset = true
            }
          }
          // La descarga siguiente (otro canal u otro mes) parte de una página sana.
          if (needsReset) await resetReportsPage()
          return results
        } catch (error) {
          throw classifyDownloadError(error)
        }
      },
    }
    return run(session)
  })
}

/**
 * Sigue el recorrido visible del portal: Informes -> Informes de Consumos ->
 * mes -> producto -> Buscar -> Descargar Detalle -> Excel, en una sesión propia.
 * Una corrida con varias descargas debe usar `withCopecPortalSession`: cada
 * llamada a esta función es un login, y cada login un correo con código.
 */
export async function downloadCopecReports(requests: CopecReportRequest[], channel: CopecChannel = "TCT"): Promise<CopecReportDownloadResult[]> {
  if (!requests.length) return []
  try {
    return await withCopecPortalSession((session) => session.download(requests, channel))
  } catch (error) {
    throw classifyDownloadError(error)
  }
}
