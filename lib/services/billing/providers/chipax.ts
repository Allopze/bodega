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
 * solicitudes y respeta `Retry-After` ante un 429.
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
import { readChipaxConfig } from "../config"

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

  async isConfigured(): Promise<boolean> {
    return readChipaxConfig().hasCredentials
  }

  async healthCheck(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString()
    const config = readChipaxConfig()

    if (!config.hasCredentials) {
      return {
        ok: false,
        detail: "Faltan credenciales: define CHIPAX_APP_ID y CHIPAX_SECRET_KEY en el servidor.",
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
    const config = readChipaxConfig()
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

    const body = await this.get<{ items?: ChipaxDte[]; paginationAttributes?: { count?: number; totalPages?: number } }>(
      `/dtes?${params}`,
    )
    // El contrato declara un array plano; la API devuelve un envoltorio. Se
    // aceptan ambos para no romperse si lo corrigen.
    const items = Array.isArray(body) ? (body as ChipaxDte[]) : body.items ?? []
    const totalPages = body?.paginationAttributes?.totalPages ?? 1

    return {
      items: items.map((dte) => this.mapDte(dte, config.companyTaxId)),
      nextCursor: page < totalPages ? String(page + 1) : null,
      reportedTotal: body?.paginationAttributes?.count ?? null,
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

    const body = await this.get<{ docs?: ChipaxCartola[]; pages?: number; total?: number }>(
      `/flujo-caja/cartolas?${params}`,
    )
    const docs = body.docs ?? []

    return {
      items: docs.map(mapCartola),
      nextCursor: page < (body.pages ?? 1) ? String(page + 1) : null,
      reportedTotal: body.total ?? null,
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

    const config = readChipaxConfig()
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
          ? "Chipax rechazó las credenciales. Revisa CHIPAX_APP_ID y CHIPAX_SECRET_KEY."
          : `Chipax rechazó la autenticación (HTTP ${response.status}).`,
        response.status === 401 || response.status === 403 ? "AUTH_FAILED" : "UNKNOWN",
        PROVIDER_ID,
      )
    }

    const body = (await response.json()) as { token?: string; tokenExpiration?: number }
    if (!body.token) {
      throw new BillingProviderError("La respuesta de login no trae token.", "PARSE_FAILED", PROVIDER_ID)
    }

    // `tokenExpiration` viene en segundos epoch.
    const expiresAt = body.tokenExpiration ? body.tokenExpiration * 1000 : Date.now() + 30 * 60_000
    this.token = { value: body.token, expiresAt }
    return body.token
  }

  /** GET autenticado, espaciado y con reintento único ante 401 o 429. */
  private async get<T>(path: string, retry = true): Promise<T> {
    const config = readChipaxConfig()

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

    if (response.status === 401 && retry) {
      // Token vencido a mitad de camino: se renueva UNA vez y se repite una
      // sola consulta idempotente. Un segundo 401 detiene el flujo.
      this.token = null
      return this.get<T>(path, false)
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "0")
      throw new BillingProviderError(
        `Chipax aplicó límite de tasa. Reintenta en ${retryAfter || 60} segundos.`,
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

    return (await response.json()) as T
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
  return String(value).slice(0, 10)
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
