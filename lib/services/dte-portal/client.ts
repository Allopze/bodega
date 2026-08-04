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

import { DtePortalError, type DtePortalClientConfig, type DtePortalCredentials } from "./types"

const CREDENTIAL_KEYS = ["rut_usr", "rut_emp", "clave"] as const

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
      requestTimeoutMs: 30_000,
      ...config,
    }
  }

  get credentials(): DtePortalCredentials {
    return this.config.credentials
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
  async downloadBinary(url: string): Promise<Buffer> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs)

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "Accept": "application/pdf, application/xml, */*" },
      })

      if (!response.ok) {
        throw new DtePortalError(
          `El portal respondió con HTTP ${response.status}`,
          response.status === 403 ? "AUTH_FAILED" : "INVALID_RESPONSE",
          response.status,
        )
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      return buffer
    } catch (error) {
      if (error instanceof DtePortalError) throw error
      throw this.normalizeError(error)
    } finally {
      clearTimeout(timer)
    }
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
    const base = this.config.baseUrl.replace(/\/+$/, "")
    const url = new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`)

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

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<string> {
    // Rate limiting
    const elapsed = Date.now() - this.lastRequestTime
    if (elapsed < this.config.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.config.delayMs - elapsed))
    }
    this.lastRequestTime = Date.now()

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs)

    try {
      const response = await fetch(url, { ...init, signal: controller.signal })

      if (!response.ok) {
        throw new DtePortalError(
          `El portal respondió con HTTP ${response.status}`,
          response.status === 403 ? "AUTH_FAILED" : "INVALID_RESPONSE",
          response.status,
        )
      }

      const arrayBuffer = await response.arrayBuffer()
      const contentType = response.headers.get("content-type") ?? ""
      const isXml = contentType.includes("application/xml") || contentType.includes("text/xml") || url.endsWith(".xml")

      const buffer = Buffer.from(arrayBuffer)

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

  private sanitizeErrorMessage(msg: string): string {
    for (const key of CREDENTIAL_KEYS) {
      if (msg.includes(key)) return "[credenciales omitidas]"
    }
    // También sanitizar si alguna credencial aparece literalmente en el mensaje
    const { rutUsr, rutEmp, clave } = this.config.credentials
    if (rutUsr && msg.includes(rutUsr)) return "[credenciales omitidas]"
    if (rutEmp && msg.includes(rutEmp)) return "[credenciales omitidas]"
    if (clave && msg.includes(clave)) return "[credenciales omitidas]"
    return msg.slice(0, 500)
  }
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