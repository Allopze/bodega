/**
 * lib/services/billing/providers/chipax.ts
 *
 * Adaptador de Chipax — **autenticación verificada, operaciones de datos no.**
 *
 * ## Lo que SÍ está verificado (2026-08-05, contra la API real)
 *
 * ```
 * POST https://api.chipax.com/v2/login  {}                     → 400 "Parámetros inválidos."
 * POST https://api.chipax.com/v2/login  {usuario, clave}       → 400 "Parámetros inválidos."   ← control
 * POST https://api.chipax.com/v2/login  {app_id, secret_key}   → 401 "Credenciales inválidas"
 * ```
 *
 * El **401** frente al **400** del control es la prueba: con `{app_id,
 * secret_key}` el servidor aceptó el esquema del cuerpo y solo rechazó los
 * valores. Por eso `login()` está implementado con esa forma exacta — no es una
 * suposición por parecido con otras API.
 *
 * ## Lo que sigue SIN verificar
 *
 * - **La forma de la respuesta exitosa**: qué campo trae el token.
 * - **El esquema de seguridad**: nombre y formato de la cabecera de autorización.
 * - **Cualquier ruta de datos**: DTE, cartolas, clientes, sus filtros y su
 *   paginación.
 *
 * El contrato OpenAPI sigue devolviendo **401** y el Swagger UI publicado apunta
 * a la plantilla de ejemplo (petstore), así que nada de eso se puede leer todavía.
 *
 * Por eso el proveedor **no declara ninguna capacidad de datos**. Lo que sí hace
 * ahora es autenticarse de verdad en `healthCheck()` y reportar los **nombres de
 * los campos** de la respuesta —nunca sus valores—, que es exactamente el dato
 * que falta para identificar el token y desbloquear el resto sin adivinar.
 */

import type { BillingProviderId } from "@/db/schema"
import { logger } from "@/lib/logger"
import {
  BillingProviderError,
  NO_CAPABILITIES,
  type BillingProvider,
  type BillingProviderCapabilities,
  type ProviderHealth,
} from "./types"
import { readChipaxConfig } from "../config"

const PROVIDER_ID: BillingProviderId = "chipax"

/**
 * Capacidades de datos reales hoy: ninguna. Se activan una por una **después**
 * de leer el contrato, no antes. Autenticarse no es leer facturas.
 */
export const CHIPAX_CAPABILITIES: BillingProviderCapabilities = { ...NO_CAPABILITIES }

export const CHIPAX_CONTRACT_BLOCKER =
  "El contrato OpenAPI de Chipax requiere autenticación (401) y el Swagger UI publicado " +
  "apunta a la plantilla de ejemplo. La autenticación sí está resuelta; faltan las rutas " +
  "de datos. Ver docs/facturacion/CHIPAX.md."

/** Resultado de autenticarse. El token nunca sale de esta capa. */
export interface ChipaxLoginResult {
  ok: boolean
  /** Código HTTP devuelto por el proveedor. */
  status: number
  /**
   * Nombres de los campos de primer nivel de la respuesta, **sin sus valores**.
   * Es lo que permite identificar dónde viene el token sin exponerlo.
   */
  responseFields: string[]
  /** Mensaje ya redactado. */
  detail: string
}

export class ChipaxProvider implements BillingProvider {
  readonly id = PROVIDER_ID
  readonly label = "Chipax"
  readonly capabilities = CHIPAX_CAPABILITIES

  async isConfigured(): Promise<boolean> {
    const config = readChipaxConfig()
    // "Configurado" exige credenciales Y contrato de datos verificado. Tener la
    // clave no habilita nada mientras no se sepa a qué operación llamar.
    return config.hasCredentials && config.contractVerified
  }

  /**
   * Autentica contra `POST /login` con el cuerpo verificado `{app_id, secret_key}`.
   *
   * No cachea el token ni lo devuelve: mientras no haya operaciones de datos,
   * exponerlo solo agrega superficie de fuga. Cuando se implementen, esta
   * función es el único lugar donde debe vivir.
   */
  async login(): Promise<ChipaxLoginResult> {
    const config = readChipaxConfig()
    if (!config.hasCredentials) {
      return {
        ok: false,
        status: 0,
        responseFields: [],
        detail: "Faltan CHIPAX_APP_ID y/o CHIPAX_SECRET_KEY en el servidor.",
      }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs)

    try {
      const response = await fetch(`${config.baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        // Exactamente los dos campos que el proveedor acepta. Nada más: agregar
        // propiedades no documentadas es la vía rápida a un 400 inexplicable.
        body: JSON.stringify({ app_id: config.appId, secret_key: config.secretKey }),
        signal: controller.signal,
        // Nunca seguir una redirección con credenciales a un host inesperado.
        redirect: "manual",
      })

      const payload = await safeJson(response)
      const responseFields = payload && typeof payload === "object" && !Array.isArray(payload)
        ? Object.keys(payload as Record<string, unknown>)
        : []

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          responseFields,
          detail: describeAuthFailure(response.status, payload),
        }
      }

      // Éxito: se reportan los NOMBRES de los campos, jamás sus valores. Es el
      // insumo para completar el esquema de seguridad en el contrato interno.
      return {
        ok: true,
        status: response.status,
        responseFields,
        detail: responseFields.length > 0
          ? `Autenticación correcta. La respuesta trae los campos: ${responseFields.join(", ")}.`
          : "Autenticación correcta, pero la respuesta no es un objeto JSON con campos de primer nivel.",
      }
    } catch (error) {
      return {
        ok: false,
        status: 0,
        responseFields: [],
        detail: redact(error, controller.signal.aborted, config.requestTimeoutMs),
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Diagnóstico sin secretos.
   *
   * Con credenciales presentes **intenta autenticarse de verdad**: es una
   * operación de solo lectura y es lo que distingue "no configurado" de
   * "credencial equivocada" de "operativo pero sin rutas de datos".
   */
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

    const result = await this.login()
    if (!result.ok) {
      logger.warn("[billing/chipax] healthCheck falló", { status: result.status })
      return { ok: false, detail: result.detail, checkedAt }
    }

    if (!config.contractVerified) {
      return {
        ok: false,
        detail: `${result.detail} Falta leer el contrato de datos y completar las operaciones de lectura; ` +
          `hasta entonces el proveedor no aporta facturas ni movimientos. ${CHIPAX_CONTRACT_BLOCKER}`,
        checkedAt,
      }
    }

    if (!config.enabled) {
      return { ok: false, detail: `${result.detail} Proveedor desactivado (BILLING_CHIPAX_ENABLED=false).`, checkedAt }
    }

    return { ok: true, detail: result.detail, checkedAt }
  }

  /**
   * Guarda explícita: cualquier intento de pedir datos antes de tener el
   * contrato falla ruidosamente en el backend, en vez de devolver listas vacías
   * que la interfaz mostraría como "no hay facturas".
   */
  assertUsable(): never {
    throw new BillingProviderError(CHIPAX_CONTRACT_BLOCKER, "CONTRACT_UNKNOWN", PROVIDER_ID)
  }
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

/**
 * Traduce el fallo a algo accionable **sin repetir el cuerpo enviado**. El
 * mensaje del proveedor se cita solo cuando es un texto corto y conocido.
 */
function describeAuthFailure(status: number, payload: unknown): string {
  const message = typeof (payload as { error?: unknown })?.error === "string"
    ? String((payload as { error: string }).error)
    : null

  switch (status) {
    case 400:
      return `El proveedor rechazó los parámetros (400${message ? `: ${message}` : ""}). ` +
        "El cuerpo enviado es {app_id, secret_key}; si el contrato cambió, hay que releerlo."
    case 401:
    case 403:
      return `Credenciales rechazadas por Chipax (${status}${message ? `: ${message}` : ""}). ` +
        "Revisa CHIPAX_APP_ID y CHIPAX_SECRET_KEY."
    case 429:
      return "Chipax aplicó límite de tasa (429). Reintenta más tarde."
    default:
      return status >= 500
        ? `Chipax respondió con un error de servidor (${status}).`
        : `Respuesta inesperada de Chipax (${status}).`
  }
}

/** Error de red/timeout redactado: nunca incluye credenciales ni el cuerpo. */
function redact(error: unknown, aborted: boolean, timeoutMs: number): string {
  if (aborted) return `Chipax no respondió dentro de ${Math.round(timeoutMs / 1000)} s.`
  const message = error instanceof Error ? error.message : String(error)
  return /app_id|secret_key|authorization|token/i.test(message)
    ? "Error de conexión con Chipax [detalle omitido por contener credenciales]."
    : `Error de conexión con Chipax: ${message}`
}
