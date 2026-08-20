/**
 * lib/services/dte-portal/client.ts
 *
 * Cliente HTTP del portal DTE FacturaEnLinea.
 *
 * Patrón: el portal PHP legacy recibe credenciales como parámetros GET en
 * cada request, procesa formularios POST y devuelve HTML. No hay API REST.
 *
 * Responsabilidades:
 * - Construir URLs con credenciales en query string
 * - Ejecutar GET/POST con timeout y manejo de errores
 * - Preservar el buffer crudo para decodificación ISO-8859-1
 * - Rate limiting entre requests
 * - Nunca exponer credenciales en logs ni errores
 *
 * @see explicacion_integral_dte_facturaenlinea.md § 2
 */

import { Agent } from "undici"
import { DtePortalError, type DtePortalClientConfig, type DtePortalCredentials } from "./types"
import { withDtePortalOperationLease } from "./operation-lease"
import { DtePortalOriginError, assertDtePortalBaseUrl, resolveDtePortalResourceUrl } from "./portal-origin"

const CREDENTIAL_KEYS = ["rut_usr", "rut_emp", "clave"] as const

/**
 * Tope de la respuesta de consulta (HTML/XML). La bandeja real más grande
 * medida —681 documentos— ocupa cientos de KB; el margen es amplísimo. Sin
 * él, `arrayBuffer()` acumulaba sin límite durante los 120 s del timeout y
 * después duplicaba la memoria con la copia latin1, con el heap de Next.js
 * como único freno. Mismo patrón que ya usaba `downloadBinary`.
 */
const MAX_DTE_HTML_BYTES = 32 * 1024 * 1024

export interface DteBinaryDownloadOptions {
  /** Límite duro antes de acumular la respuesta completa en memoria. */
  maxBytes?: number
}

/**
 * El portal es un servidor legacy que solo negocia TLS 1.2 con ciphers
 * SECLEVEL 0 — verificado 2026-08-04: el `fetch` nativo de Node falla con
 * `ERR_SSL_WRONG_SIGNATURE_TYPE` sin este ajuste (mismo motivo por el que
 * curl necesita `--tlsv1.2 --ciphers DEFAULT@SECLEVEL=0`). El certificado sí
 * valida correctamente (no hace falta `rejectUnauthorized: false`).
 */
const LEGACY_TLS_DISPATCHER = new Agent({
  connect: {
    ciphers: "DEFAULT@SECLEVEL=0",
    minVersion: "TLSv1.2",
    maxVersion: "TLSv1.2",
  },
})

/**
 * Objeto de fetch reutilizable que incluye sanitización de credenciales en
 * logs, timeout y decodificación ISO-8859-1.
 */
export class DtePortalClient {
  private readonly config: Required<DtePortalClientConfig>
  private lastRequestTime = 0

  constructor(config: DtePortalClientConfig) {
    this.config = {
      delayMs: 500,
      requestTimeoutMs: 120_000, // Bandeja de Entrada puede tardar ~80s, ver config.ts
      ...config,
      baseUrl: assertDtePortalBaseUrl(config.baseUrl),
    }
  }

  get credentials(): DtePortalCredentials {
    return this.config.credentials
  }

  /** URL base sin credenciales (nunca las lleva) — para resolver URLs relativas. */
  get baseUrl(): string {
    return this.config.baseUrl.replace(/\/+$/, "")
  }

  /**
   * Ejecuta un GET al portal. Las credenciales se agregan automáticamente como
   * query params. El cuerpo se devuelve como string decodificado.
   */
  async get(path: string, extraParams?: Record<string, string>): Promise<string> {
    const url = this.buildUrl(path, extraParams)
    return this.fetchWithTimeout(url.toString(), { method: "GET" })
  }

  /**
   * Ejecuta un POST al portal. Las credenciales se agregan como query params
   * en la URL (patrón del portal), y `body` se envía como
   * application/x-www-form-urlencoded.
   */
  async post(path: string, body: Record<string, string>, extraParams?: Record<string, string>): Promise<string> {
    const url = this.buildUrl(path, extraParams)
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(body)) {
      params.set(key, value)
    }
    return this.fetchWithTimeout(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    })
  }

  /**
   * Descarga un XML o PDF como buffer binario. Útil para preservar la
   * codificación original del XML y luego aplicar decodeXmlBuffer().
   */
  async downloadBinary(url: string, options: DteBinaryDownloadOptions = {}): Promise<Buffer> {
    const maxBytes = options.maxBytes
    if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 1)) {
      throw new DtePortalError("El límite de descarga DTE no es válido", "INVALID_RESPONSE")
    }

    let safeUrl: string
    try {
      // El portal aplica las mismas credenciales GET a enlaces binarios. Sin
      // ellas el PDF puede redirigir al login y terminar pareciendo un archivo
      // corrupto, aun cuando el post= sea válido.
      safeUrl = this.buildUrl(url).toString()
    } catch (error) {
      if (error instanceof DtePortalOriginError) {
        throw new DtePortalError("La descarga DTE apunta fuera del origen permitido", "INVALID_RESPONSE")
      }
      throw error
    }
    return withDtePortalOperationLease("download", this.operationLeaseMs(), async () => {
      await this.throttle()

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs)

      try {
        const response = await fetch(safeUrl, {
          signal: controller.signal,
          headers: { "Accept": "application/pdf, application/xml, */*" },
          // Igual que en fetchWithTimeout: un redirect seguido devolvería el HTML
          // del login y `downloadDteXml` lo rechazaría con "no parece un XML DTE",
          // culpando al documento en vez de a la sesión.
          redirect: "manual",
          dispatcher: LEGACY_TLS_DISPATCHER,
        } as RequestInit)

        if (response.status >= 300 && response.status < 400) {
          throw new DtePortalError(
            `El portal redirigió la descarga (HTTP ${response.status}). Suele significar sesión o credenciales rechazadas.`,
            "AUTH_FAILED",
            response.status,
          )
        }

        if (!response.ok) {
          throw new DtePortalError(
            `El portal respondió con HTTP ${response.status}`,
            response.status === 403 ? "AUTH_FAILED" : "INVALID_RESPONSE",
            response.status,
          )
        }

        const contentLength = response.headers.get("content-length")
        if (maxBytes !== undefined && contentLengthExceedsLimit(contentLength, maxBytes)) {
          throw new DtePortalError("La descarga DTE supera el límite permitido", "INVALID_RESPONSE")
        }

        return await readBinaryResponse(response, maxBytes)
      } catch (error) {
        if (error instanceof DtePortalError) throw error
        throw this.normalizeError(error)
      } finally {
        clearTimeout(timer)
      }
    })
  }

  /** Lee el status de la configuración (sin exponer credenciales) */
  getStatus(): { configured: boolean; baseUrl: string; hasCredentials: boolean } {
    const { credentials, baseUrl } = this.config
    return {
      configured: Boolean(credentials.rutUsr && credentials.rutEmp && credentials.clave && credentials.codEmp),
      baseUrl: this.sanitizeUrl(baseUrl),
      hasCredentials: Boolean(credentials.rutUsr && credentials.rutEmp),
    }
  }

  // ── Privado ───────────────────────────────────────────────────────────────

  private buildUrl(path: string, extraParams?: Record<string, string>): URL {
    let url: URL
    try {
      url = new URL(resolveDtePortalResourceUrl(path, this.config.baseUrl))
    } catch (error) {
      if (error instanceof DtePortalOriginError) {
        throw new DtePortalError("La consulta DTE apunta fuera del origen permitido", "INVALID_RESPONSE")
      }
      throw error
    }

    // Credenciales viajan en toda request (patrón del portal § 2)
    const { rutUsr, rutEmp, clave } = this.config.credentials
    url.searchParams.set("rut_usr", rutUsr)
    url.searchParams.set("rut_emp", rutEmp)
    url.searchParams.set("clave", clave)

    if (extraParams) {
      for (const [key, value] of Object.entries(extraParams)) {
        url.searchParams.set(key, value)
      }
    }

    return url
  }

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestTime
    if (elapsed < this.config.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.config.delayMs - elapsed))
    }
    this.lastRequestTime = Date.now()
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<string> {
    return withDtePortalOperationLease("query", this.operationLeaseMs(), async () => {
      await this.throttle()

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs)

      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal,
          // `manual`: sin esto, fetch sigue el redirect y devuelve el HTML de la
          // página de destino —típicamente un login— como si fuera la respuesta
          // pedida. El parser falla después con "el HTML del portal cambió o las
          // credenciales son inválidas", que manda a investigar lo que no es.
          // Mismo criterio que el cliente de Chipax.
          redirect: "manual",
          dispatcher: LEGACY_TLS_DISPATCHER,
        } as RequestInit)

        if (response.status >= 300 && response.status < 400) {
          throw new DtePortalError(
            `El portal redirigió la consulta (HTTP ${response.status}). Suele significar sesión o credenciales rechazadas.`,
            "AUTH_FAILED",
            response.status,
          )
        }

        if (!response.ok) {
          throw new DtePortalError(
            `El portal respondió con HTTP ${response.status}`,
            response.status === 403 ? "AUTH_FAILED" : "INVALID_RESPONSE",
            response.status,
          )
        }

        if (contentLengthExceedsLimit(response.headers.get("content-length"), MAX_DTE_HTML_BYTES)) {
          throw new DtePortalError("La respuesta del portal DTE supera el límite permitido", "INVALID_RESPONSE")
        }

        const contentType = response.headers.get("content-type") ?? ""
        const isXml = contentType.includes("application/xml") || contentType.includes("text/xml") || url.endsWith(".xml")

        const buffer = await readBinaryResponse(response, MAX_DTE_HTML_BYTES)

        if (isXml) {
          return decodeXmlBuffer(buffer)
        }

        // HTML: detectar encoding desde meta tag, XML declaration, o default latin1
        const raw = buffer.toString("latin1")
        const metaEncoding = raw.match(/<meta[^>]*charset=["']?([^"'\s>]+)/i)?.[1]?.toLowerCase()
        const xmlDeclEncoding = raw.match(/<\?xml[^>]*encoding=["']([^"']+)/i)?.[1]?.toLowerCase()

        if (metaEncoding === "utf-8" || xmlDeclEncoding === "utf-8") {
          return buffer.toString("utf8")
        }
        // Por defecto, el portal sirve en ISO-8859-1
        return raw
      } catch (error) {
        if (error instanceof DtePortalError) throw error
        throw this.normalizeError(error)
      } finally {
        clearTimeout(timer)
      }
    })
  }

  private operationLeaseMs(): number {
    // Deja un margen sólo para finalizar lectura y liberar el lease tras el
    // timeout de red. No es una fuente de liveness: el expiry siempre es finito.
    return this.config.requestTimeoutMs + 30_000
  }

  private normalizeError(error: unknown): DtePortalError {
    const msg = error instanceof Error ? error.message : String(error)
    const lower = msg.toLowerCase()

    if (lower.includes("abort") || lower.includes("timeout")) {
      return new DtePortalError(
        `El portal DTE no respondió a tiempo (timeout ${this.config.requestTimeoutMs}ms)`,
        "TIMEOUT",
      )
    }
    if (lower.includes("fetch") || lower.includes("network") || lower.includes("econnrefused") || lower.includes("enotfound")) {
      return new DtePortalError(
        `No se pudo conectar con el portal DTE: ${this.sanitizeErrorMessage(msg)}`,
        "NETWORK_ERROR",
      )
    }
    return new DtePortalError(
      `Error al consultar el portal DTE: ${this.sanitizeErrorMessage(msg)}`,
      "UNKNOWN",
    )
  }

  /**
   * Reemplaza las credenciales en un mensaje para evitar leak en logs.
   */
  private sanitizeUrl(url: string): string {
    let sanitized = url
    for (const key of CREDENTIAL_KEYS) {
      sanitized = sanitized.replace(
        new RegExp(`(${key}=)[^&]+`, "g"),
        `$1***`,
      )
    }
    return sanitized
  }

  private sanitizeErrorMessage(_msg: string): string {
    // Fetch/undici errors can embed a complete request URL or a proxy response.
    // Codes above preserve the actionable class; do not persist or forward raw
    // transport text to a route, logger, audit record, or Sentry.
    return "[detalle técnico omitido]"
  }
}

function contentLengthExceedsLimit(contentLength: string | null, maxBytes: number): boolean {
  if (!contentLength || !/^\d+$/.test(contentLength)) return false
  return Number(contentLength) > maxBytes
}

async function readBinaryResponse(response: Response, maxBytes: number | undefined): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0)

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      total += value.byteLength
      if (maxBytes !== undefined && total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new DtePortalError("La descarga DTE supera el límite permitido", "INVALID_RESPONSE")
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }

  return Buffer.concat(chunks, total)
}

/**
 * Decodifica un buffer XML respetando la declaración de encoding.
 *
 * Los DTE chilenos frecuentemente declaran ISO-8859-1 en el XML; decodificarlos
 * como UTF-8 corrompe los caracteres del nombre del proveedor/producto.
 *
 * Reutiliza el mismo patrón de `invoice-extractor.ts` (decodeXmlBuffer).
 */
export function decodeXmlBuffer(buffer: Buffer): string {
  const declaration = buffer.toString("latin1", 0, Math.min(buffer.length, 1024))
  const encoding = declaration.match(/<\?xml[^>]*encoding=["']([^"']+)/i)?.[1]?.toLowerCase()
  if (encoding && /^(iso-8859-1|iso8859-1|latin-?1|windows-1252)$/i.test(encoding)) {
    return buffer.toString("latin1")
  }
  return buffer.toString("utf8")
}
