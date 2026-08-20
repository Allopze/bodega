/**
 * lib/services/billing/providers/chipax.ts
 *
 * Adaptador de Chipax — **implementado contra el contrato real**.
 *
 * ## Contrato verificado (2026-08-05)
 *
 * El documento OpenAPI 3.0.1 («Chipax API v2.0», 28 operaciones) no está en
 * `/swagger.json` —eso da 404— sino **embebido en el bundle de Swagger UI**:
 * `GET /v2/swagger-docs/swagger-ui-init.js`, dentro de `options.swaggerDoc`.
 *
 * De ahí salen, sin adivinar:
 *
 * | Elemento | Valor |
 * |---|---|
 * | `servers` | `https://api.chipax.com/v2/` |
 * | Seguridad | `apiKey` en cabecera **`Authorization`**, con el valor **`JWT <token>`** |
 * | Autenticación | `POST /login` con `{app_id, secret_key}` → `{message, token, tokenExpiration, nombre}` |
 *
 * El prefijo es `JWT`, **no** `Bearer`: con `Bearer` la API responde 401. Y como
 * el middleware de autenticación corre antes del enrutado, una cabecera
 * equivocada devuelve 401 hasta en rutas inexistentes — por eso el prefijo
 * correcto no se puede deducir probando, hay que leerlo del contrato.
 *
 * ## Discrepancia contrato ↔ realidad
 *
 * El contrato declara que `GET /dtes` devuelve un array plano. **La API real
 * devuelve `{items, paginationAttributes}`.** Manda la respuesta real: el
 * adaptador tolera ambas formas para no romperse si lo corrigen.
 *
 * ## Límite de tasa
 *
 * La API responde `x-ratelimit-limit: 60` por minuto. El cliente espaciа las
 * solicitudes y respeta `Retry-After` ante un 429; si el 429 no trae la cabecera,
 * espera un piso antes del único reintento en vez de volver a chocar enseguida.
 */

import type { BillingProviderId } from "@/db/schema"
import { cleanRut } from "@/lib/rut"
import { logger } from "@/lib/logger"
import {
  BillingProviderError,
  NO_CAPABILITIES,
  type BillingProvider,
  type BillingProviderCapabilities,
  type ProviderBankTransaction,
  type ProviderHealth,
  type ProviderInvoice,
  type ProviderPage,
  type ProviderPeriodQuery,
} from "./types"
import { readChipaxConfig } from "../chipax-settings"
import type { ChipaxConfig } from "../config"

const PROVIDER_ID: BillingProviderId = "chipax"

/**
 * Capacidades verificadas una por una contra la API real.
 *
 * `canListReceivedInvoices` queda en `false` aunque `GET /compras` exista en el
 * contrato: no se verificó su forma de respuesta, y las facturas de proveedor ya
 * las cubre FacturaEnLínea en el módulo de Compras. Se activará cuando se
 * verifique, no antes.
 */
export const CHIPAX_CAPABILITIES: BillingProviderCapabilities = {
  ...NO_CAPABILITIES,
  canListIssuedInvoices: true,
  canListBankTransactions: true,
}

export const CHIPAX_CONTRACT_BLOCKER =
  "Operación no implementada para Chipax: su contrato no la cubre o no se verificó."

/** Milisegundos entre solicitudes para no acercarse al límite de 60/min. */
const REQUEST_SPACING_MS = 1100
/** Tamaño de página observado en `/dtes`; la API no permite cambiarlo. */
const DTE_PAGE_SIZE = 50
/**
 * Techo defensivo de filas por página, para ambos endpoints. Acota la memoria de
 * una respuesta desmesurada, pero NO verifica el tamaño de página: pegarlo al
 * valor observado convertía una subida silenciosa de la página del proveedor en
 * corridas fallidas permanentes.
 */
const MAX_ITEMS_PER_PAGE = 1_000
/** El total declarado no puede abrir una corrida de páginas sin límite. */
const MAX_DECLARED_PAGES = 10_000
/** Nunca se obedece un Retry-After arbitrariamente largo. */
const MAX_RETRY_AFTER_MS = 30_000
/**
 * Espera mínima ante un 429 **sin** cabecera `Retry-After`. Sin piso, el único
 * reintento salía ~1,1 s después —dentro de la misma ventana de 60/min que
 * gatilló el límite— y volvía a chocar, abortando la corrida completa.
 */
const MIN_RETRY_AFTER_MS = 15_000

interface ChipaxDte {
  id: number
  tipo: number
  folio: number
  rut: string
  razonSocial: string
  fechaEmision: string
  fechaVencimiento: string | null
  montoNeto: number
  montoExento: number
  montoTotal: number
  iva: number
}

interface ChipaxCartola {
  id: number
  fecha: string
  abono: number
  cargo: number
  descripcion: string | null
  comentario_transferencia: string | null
  cuenta_corriente_id: number
}

export class ChipaxProvider implements BillingProvider {
  readonly id = PROVIDER_ID
  readonly label = "Chipax"
  readonly capabilities = CHIPAX_CAPABILITIES

  /** Token en memoria. Nunca sale de la instancia ni se persiste. */
  private token: { value: string; expiresAt: number } | null = null
  private lastRequestAt = 0
  /**
   * La configuración ahora vive en `system_settings`, así que leerla cuesta una
   * consulta. Se memoriza por instancia: el registro crea un proveedor nuevo por
   * corrida, de modo que una rotación de credenciales entra en la siguiente sin
   * que una sincronización de 60 páginas dispare 60 consultas iguales.
   */
  private configPromise: Promise<ChipaxConfig> | null = null

  private config(): Promise<ChipaxConfig> {
    return (this.configPromise ??= readChipaxConfig())
  }

  async isConfigured(): Promise<boolean> {
    return (await this.config()).hasCredentials
  }

  async healthCheck(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString()
    const config = await this.config()

    if (!config.hasCredentials) {
      return {
        ok: false,
        detail: "Faltan credenciales: cárgalas en «Credenciales» de esta misma tarjeta, o define CHIPAX_APP_ID y CHIPAX_SECRET_KEY en el servidor.",
        checkedAt,
      }
    }

    try {
      // Consulta mínima y no sensible: el catálogo de monedas.
      await this.get<unknown>("/monedas")
      const empresa = config.companyTaxId
        ? ""
        : " Falta BILLING_COMPANY_TAX_ID (o DTE_PORTAL_RUT_EMP) para identificar al emisor de las ventas."
      return {
        ok: !empresa,
        detail: `Autenticación y lectura correctas contra ${config.baseUrl}.${empresa}`,
        checkedAt,
      }
    } catch (error) {
      const detail = error instanceof BillingProviderError ? error.message : redact(error)
      logger.warn("[billing/chipax] healthCheck falló")
      return { ok: false, detail, checkedAt }
    }
  }

  /**
   * Facturas de venta del período.
   *
   * `GET /dtes?fechaInicial&fechaFinal&page` — filtros y paginación del
   * contrato. `nextCursor` lleva el número de página siguiente.
   */
  async listIssuedInvoices(query: ProviderPeriodQuery): Promise<ProviderPage<ProviderInvoice>> {
    const config = await this.config()
    if (!config.companyTaxId) {
      throw new BillingProviderError(
        "Falta el RUT de la empresa (BILLING_COMPANY_TAX_ID o DTE_PORTAL_RUT_EMP): sin él no se puede " +
        "identificar al emisor de una factura de venta.",
        "NOT_CONFIGURED",
        PROVIDER_ID,
      )
    }

    const page = parseCursor(query.cursor)
    const params = new URLSearchParams({
      fechaInicial: `${query.period}-01`,
      fechaFinal: endOfMonth(query.period),
      page: String(page),
    })

    const body = await this.get<unknown>(`/dtes?${params}`)
    const parsed = parseDteResponse(body, page)
    const items = parsed.items
    const totalPages = parsed.totalPages

    return {
      items: items.map((dte) => this.mapDte(dte, config.companyTaxId)),
      nextCursor: page < totalPages ? String(page + 1) : null,
      reportedTotal: parsed.reportedTotal,
    }
  }

  /**
   * Movimientos bancarios del período.
   *
   * `GET /flujo-caja/cartolas?startDate&endDate&page` → `{docs, pages, total}`.
   */
  async listBankTransactions(query: ProviderPeriodQuery): Promise<ProviderPage<ProviderBankTransaction>> {
    const page = parseCursor(query.cursor)
    const params = new URLSearchParams({
      startDate: `${query.period}-01`,
      endDate: endOfMonth(query.period),
      page: String(page),
    })

    const body = await this.get<unknown>(`/flujo-caja/cartolas?${params}`)
    const parsed = parseCartolaResponse(body, page)
    const docs = parsed.items

    return {
      items: docs.map(mapCartola),
      nextCursor: page < parsed.totalPages ? String(page + 1) : null,
      reportedTotal: parsed.reportedTotal,
    }
  }

  /* ── Interno ─────────────────────────────────────────────────────────────── */

  /** Autentica y cachea el token mientras siga vigente. */
  private async authenticate(): Promise<string> {
    // Margen de 60 s para no usar un token que expira a mitad de la corrida.
    if (this.token && this.token.expiresAt - 60_000 > Date.now()) return this.token.value

    // El login cuenta contra el mismo límite de 60/min que el resto: sin
    // espaciarlo, una renovación de token disparaba dos solicitudes seguidas
    // (login + consulta) y el reintento por 401 encadenaba tres
    // (H-16, AUDITORIA_BUGS_2026-08-05.md).
    await this.space()

    const config = await this.config()
    const response = await fetch(`${config.baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ app_id: config.appId, secret_key: config.secretKey }),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
      redirect: "manual",
    })

    if (!response.ok) {
      throw new BillingProviderError(
        response.status === 401 || response.status === 403
          ? "Chipax rechazó las credenciales. Revísalas en «Credenciales» de la tarjeta de Chipax (o en CHIPAX_APP_ID y CHIPAX_SECRET_KEY del servidor)."
          : `Chipax rechazó la autenticación (HTTP ${response.status}).`,
        response.status === 401 || response.status === 403 ? "AUTH_FAILED" : "UNKNOWN",
        PROVIDER_ID,
      )
    }

    const body = (await readJson(response, "/login")) as { token?: string; tokenExpiration?: number }
    if (!body.token) {
      throw new BillingProviderError("La respuesta de login no trae token.", "PARSE_FAILED", PROVIDER_ID)
    }

    // `tokenExpiration` viene en segundos epoch.
    const expiresAt = body.tokenExpiration ? body.tokenExpiration * 1000 : Date.now() + 30 * 60_000
    this.token = { value: body.token, expiresAt }
    return body.token
  }

  /** GET autenticado, espaciado y con un reintento único ante 401 y 429. */
  private async get<T>(path: string, retry401 = true, retry429 = true): Promise<T> {
    const config = await this.config()

    // Autenticar primero y espaciar después: `authenticate()` espacia su
    // propio login cuando toca renovar, así cada solicitud HTTP real queda
    // precedida por su propia espera. Al revés, la espera del GET se consumía
    // antes del login y ambas salían pegadas.
    const token = await this.authenticate()
    await this.space()

    const response = await fetch(`${config.baseUrl}${path}`, {
      // El contrato lo dice explícitamente: el valor va con el prefijo "JWT".
      headers: { Authorization: `JWT ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(config.requestTimeoutMs),
      redirect: "manual",
    })

    if (response.status === 401 && retry401) {
      // Token vencido a mitad de camino: se renueva UNA vez y se repite una
      // sola consulta idempotente. Un segundo 401 detiene el flujo.
      this.token = null
      return this.get<T>(path, false, retry429)
    }

    if (response.status === 429 && retry429) {
      // Cuando el proveedor no dice cuánto esperar, se aplica el piso: reintentar
      // de inmediato garantiza el segundo 429 y con él una corrida fallida.
      const retryAfter = parseRetryAfter(response.headers.get("retry-after")) ?? MIN_RETRY_AFTER_MS
      if (retryAfter > 0) await new Promise((resolve) => setTimeout(resolve, retryAfter))
      return this.get<T>(path, retry401, false)
    }

    if (response.status === 429) {
      const retryAfter = parseRetryAfter(response.headers.get("retry-after")) ?? 0
      throw new BillingProviderError(
        `Chipax aplicó límite de tasa después del reintento. Reintenta en ${Math.ceil(retryAfter / 1000) || 60} segundos.`,
        "RATE_LIMITED",
        PROVIDER_ID,
      )
    }

    if (!response.ok) {
      throw new BillingProviderError(
        `Chipax respondió HTTP ${response.status} en ${path.split("?")[0]}.`,
        response.status >= 500 ? "NETWORK_ERROR" : "UNKNOWN",
        PROVIDER_ID,
      )
    }

    return (await readJson(response, path)) as T
  }

  /** Espacia las solicitudes para no acercarse al límite de 60 por minuto. */
  private async space(): Promise<void> {
    const wait = this.lastRequestAt + REQUEST_SPACING_MS - Date.now()
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    this.lastRequestAt = Date.now()
  }

  /** DTE de venta de Chipax → documento normalizado. */
  private mapDte(dte: ChipaxDte, companyTaxId: string): ProviderInvoice {
    return {
      externalId: `chipax:dte:${dte.id}`,
      direction: "sale",
      docType: String(dte.tipo),
      folio: dte.folio,
      // En una venta el emisor es la propia empresa: Chipax no lo repite en
      // cada documento porque para él es implícito.
      issuerTaxId: cleanRut(companyTaxId),
      issuerName: null,
      receiverTaxId: dte.rut ? cleanRut(dte.rut) : null,
      receiverName: dte.razonSocial || null,
      issueDate: isoDay(dte.fechaEmision),
      dueDate: dte.fechaVencimiento ? isoDay(dte.fechaVencimiento) : null,
      currency: "CLP",
      netAmount: numberOrNull(dte.montoNeto),
      taxAmount: numberOrNull(dte.iva),
      exemptAmount: numberOrNull(dte.montoExento),
      totalAmount: dte.montoTotal,
      // Chipax no informa el estado en el SII: dejarlo en `unknown` evita que
      // pise el estado real que sí entrega FacturaEnLínea.
      documentStatus: "unknown",
      externalStatus: null,
      documentUrl: null,
      xmlUrl: null,
      accountRef: null,
      items: [],
    }
  }
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function mapCartola(row: ChipaxCartola): ProviderBankTransaction {
  // `abono` entra y `cargo` sale: el signo lo define la diferencia.
  const amount = Math.round(((row.abono ?? 0) - (row.cargo ?? 0)) * 100) / 100
  const glosa = [row.descripcion, row.comentario_transferencia].filter(Boolean).join(" · ")

  return {
    externalId: `chipax:cartola:${row.id}`,
    transactionDate: isoDay(row.fecha),
    amount,
    currency: "CLP",
    // Glosa del banco: dato NO confiable, se sanitiza al mostrar y al exportar.
    description: glosa || null,
    // La cartola no identifica la contraparte; la conciliación se apoyará en
    // monto, fecha y folio en la glosa.
    counterpartyName: null,
    counterpartyTaxId: null,
    // Identificador interno de la cuenta, no su número: no hay nada que enmascarar.
    accountRef: `cc:${row.cuenta_corriente_id}`,
  }
}

function parseCursor(cursor: string | null | undefined): number {
  const page = Number.parseInt(cursor ?? "1", 10)
  return Number.isSafeInteger(page) && page >= 1 ? page : 1
}

function isoDay(value: string): string {
  const day = String(value).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) invalidResponse("fecha con formato inválido")
  const parsed = new Date(`${day}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
    invalidResponse("fecha inválida")
  }
  return day
}

function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function endOfMonth(period: string): string {
  const [year, month] = period.split("-").map(Number) as [number, number]
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

function redact(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return /app_id|secret_key|authorization|token/i.test(message)
    ? "Error de conexión con Chipax [detalle omitido por contener credenciales]."
    : `Error de conexión con Chipax: ${message}`
}

export { DTE_PAGE_SIZE }

function parseDteResponse(body: unknown, page: number): {
  items: ChipaxDte[]
  totalPages: number
  reportedTotal: number | null
} {
  const envelope = Array.isArray(body) ? { items: body } : record(body)
  const items = envelope.items
  if (!Array.isArray(items) || items.length > MAX_ITEMS_PER_PAGE) invalidResponse("/dtes: items inválidos o sobre el techo por página")
  const pagination = envelope.paginationAttributes === undefined ? {} : record(envelope.paginationAttributes)
  const declaredPages = pagination.totalPages ?? null
  // Sin paginación fiable no se puede concluir «esto era todo»: una página llena
  // significa que hay más. Asumir una sola página perdía documentos en silencio y
  // además apagaba la única guardia de pérdida del sync (que exige total declarado).
  const totalPages = declaredPages === null
    ? (items.length >= DTE_PAGE_SIZE ? page + 1 : page)
    : positivePageCount(declaredPages, page)
  const reportedTotal = optionalNonNegativeNumber(pagination.count)
  return { items: parseRows(items, parseDte, "/dtes"), totalPages, reportedTotal }
}

function parseCartolaResponse(body: unknown, page: number): {
  items: ChipaxCartola[]
  totalPages: number
  reportedTotal: number | null
} {
  // The published contract has also returned a plain array in older tenants;
  // accept it as a one-page response while keeping the runtime checks below.
  const envelope = Array.isArray(body) ? { docs: body } : record(body)
  const items = envelope.docs
  if (!Array.isArray(items) || items.length > MAX_ITEMS_PER_PAGE) invalidResponse("/flujo-caja/cartolas: docs inválidos o sobre el techo por página")
  const declaredPages = envelope.pages ?? null
  const reportedTotal = optionalNonNegativeNumber(envelope.total)
  // La cartola no fija tamaño de página, así que la única señal de que falta leer
  // es el total declarado: mientras supere lo entregado hasta acá, se sigue
  // paginando. Es una estimación (supone páginas parejas), pero nunca da por
  // cerrado un mes incompleto; el tope de páginas del sync acota la corrida.
  const totalPages = declaredPages === null
    ? (reportedTotal !== null && items.length > 0 && reportedTotal > page * items.length ? page + 1 : page)
    : positivePageCount(declaredPages, page)
  return { items: parseRows(items, parseCartola, "/flujo-caja/cartolas"), totalPages, reportedTotal }
}

/**
 * Parsea fila por fila tolerando el fallo individual.
 *
 * Un campo inesperado en un documento no puede tumbar la página completa —y con
 * ella el mes entero, todas las mañanas— cuando las demás filas son válidas. La
 * fila descartada queda en el log y el total declarado por el proveedor se
 * conserva intacto, que es lo que el sync compara para marcar la corrida parcial.
 * Si NINGUNA fila cumple el contrato, la respuesta se rechaza entera: eso ya no
 * es un dato de borde sino otra forma de respuesta.
 */
function parseRows<T>(items: unknown[], parse: (value: unknown) => T, source: string): T[] {
  const rows: T[] = []
  for (const item of items) {
    try {
      rows.push(parse(item))
    } catch (error) {
      logger.warn("[billing/chipax] fila descartada por no cumplir el contrato", {
        source,
        detail: error instanceof BillingProviderError ? error.message : "UNKNOWN",
      })
    }
  }
  if (rows.length === 0 && items.length > 0) invalidResponse(`${source}: ninguna fila cumple el contrato`)
  return rows
}

/** Un 200 con cuerpo que no es JSON (proxy, WAF, página de mantención) debe
 * llegar al historial como respuesta inválida con su ruta, no como un
 * SyntaxError crudo que el sync sustituye por «detalle técnico omitido». */
async function readJson(response: Response, path: string): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    invalidResponse(`cuerpo no es JSON en ${path.split("?")[0]}`)
  }
}

function parseDte(value: unknown): ChipaxDte {
  const row = record(value)
  return {
    id: positiveInteger(row.id, "id"),
    tipo: positiveInteger(row.tipo, "tipo"),
    folio: nonNegativeInteger(row.folio, "folio"),
    rut: requiredString(row.rut, "rut"),
    razonSocial: requiredString(row.razonSocial, "razonSocial"),
    fechaEmision: requiredString(row.fechaEmision, "fechaEmision"),
    fechaVencimiento: row.fechaVencimiento === null ? null : optionalString(row.fechaVencimiento, "fechaVencimiento"),
    montoNeto: finiteNumber(row.montoNeto, "montoNeto"),
    montoExento: finiteNumber(row.montoExento, "montoExento"),
    montoTotal: finiteNumber(row.montoTotal, "montoTotal"),
    iva: finiteNumber(row.iva, "iva"),
  }
}

function parseCartola(value: unknown): ChipaxCartola {
  const row = record(value)
  return {
    id: positiveInteger(row.id, "id"),
    fecha: requiredString(row.fecha, "fecha"),
    abono: finiteNumber(row.abono, "abono"),
    cargo: finiteNumber(row.cargo, "cargo"),
    descripcion: row.descripcion === null ? null : optionalString(row.descripcion, "descripcion"),
    comentario_transferencia: row.comentario_transferencia === null
      ? null
      : optionalString(row.comentario_transferencia, "comentario_transferencia"),
    cuenta_corriente_id: positiveInteger(row.cuenta_corriente_id, "cuenta_corriente_id"),
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidResponse("respuesta no es un objeto")
  return value as Record<string, unknown>
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") invalidResponse(`${field} ausente`)
  return value
}

function optionalString(value: unknown, field: string): string {
  if (typeof value !== "string") invalidResponse(`${field} inválido`)
  return value
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalidResponse(`${field} no es numérico`)
  return value
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) invalidResponse(`${field} inválido`)
  return value
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalidResponse(`${field} inválido`)
  return value
}

function optionalNonNegativeNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) invalidResponse("total declarado inválido")
  return value
}

function positivePageCount(value: unknown, page: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_DECLARED_PAGES || page > value) {
    invalidResponse("total de páginas inválido")
  }
  return value
}

/** Milisegundos que pide la cabecera, o `null` si no la hay o no se entiende. */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.trunc(seconds * 1000), MAX_RETRY_AFTER_MS)
  }
  const retryAt = Date.parse(value)
  if (!Number.isFinite(retryAt)) return null
  return Math.min(Math.max(retryAt - Date.now(), 0), MAX_RETRY_AFTER_MS)
}

function invalidResponse(detail: string): never {
  throw new BillingProviderError(`Respuesta inválida de Chipax: ${detail}.`, "INVALID_RESPONSE", PROVIDER_ID)
}
