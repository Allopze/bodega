/**
 * lib/services/billing/providers/chipax.ts
 *
 * Adaptador de Chipax — **arquitectura completa, capacidades desactivadas.**
 *
 * ## Por qué no hay rutas ni esquemas acá
 *
 * Verificado el 2026-08-04 contra la API pública:
 *
 * ```
 * GET  https://api.chipax.com/v2/swagger-docs/                → 200, Swagger UI estático
 * GET  .../swagger-docs/swagger-initializer.js                → url: petstore.swagger.io  (plantilla sin configurar)
 * GET  https://api.chipax.com/v2/swagger.json                 → 401 {"message":"Unauthorized"}
 * GET  https://api.chipax.com/v2/api-docs                     → 401
 * GET  https://api.chipax.com/v2/openapi.json                 → 401
 * POST https://api.chipax.com/v2/login   (cuerpo vacío)       → 400 {"error":"Parámetros inválidos."}
 * ```
 *
 * El endpoint de login existe y valida parámetros, pero **el contrato OpenAPI
 * no es público**. Escribir rutas, nombres de filtros, formas de paginación o
 * esquemas de respuesta sin leerlo sería inventarlos, y en una integración
 * financiera eso es precisamente el fallo que hay que evitar. Por eso este
 * proveedor declara todas sus capacidades en `false` y su `healthCheck`
 * reporta el bloqueo en vez de fingir salud.
 *
 * ## Qué falta exactamente para activarlo
 *
 * 1. Credenciales de API de Chipax en `CHIPAX_LOGIN_PAYLOAD_JSON` (nunca en el
 *    repositorio) para poder leer el contrato.
 * 2. Con el contrato en mano, completar `references` en `chipax-contract.ts`:
 *    servidor (bloque `servers`), esquema de seguridad, y por cada operación su
 *    método, ruta, parámetros requeridos, cuerpo y respuesta.
 * 3. Implementar `listIssuedInvoices` / `listBankTransactions` con los tipos
 *    derivados del contrato y activar solo esas capacidades.
 * 4. Encender el flag `BILLING_CHIPAX_ENABLED`.
 *
 * Toda operación de escritura queda fuera de alcance: `canCreateInvoices` y
 * `canCreateExpenses` no se activan sin una decisión de negocio explícita.
 */

import type { BillingProviderId } from "@/db/schema"
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
 * Capacidades reales hoy: ninguna. Se activan una por una **después** de
 * verificarlas contra el contrato vigente, no antes.
 */
export const CHIPAX_CAPABILITIES: BillingProviderCapabilities = { ...NO_CAPABILITIES }

export const CHIPAX_CONTRACT_BLOCKER =
  "El contrato OpenAPI de Chipax requiere autenticación (401) y el Swagger UI publicado " +
  "apunta a la plantilla de ejemplo. Sin leer el contrato vigente no se implementan " +
  "operaciones: ver docs/facturacion/CHIPAX.md."

export class ChipaxProvider implements BillingProvider {
  readonly id = PROVIDER_ID
  readonly label = "Chipax"
  readonly capabilities = CHIPAX_CAPABILITIES

  async isConfigured(): Promise<boolean> {
    const config = readChipaxConfig()
    // "Configurado" exige credenciales Y contrato verificado. Tener la clave no
    // habilita nada mientras no se sepa a qué operación llamar.
    return config.hasCredentials && config.contractVerified
  }

  async healthCheck(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString()
    const config = readChipaxConfig()

    if (!config.enabled) {
      return { ok: false, detail: "Proveedor desactivado (BILLING_CHIPAX_ENABLED=false).", checkedAt }
    }
    if (!config.hasCredentials) {
      return { ok: false, detail: "Faltan credenciales de Chipax en el servidor.", checkedAt }
    }
    if (!config.contractVerified) {
      return { ok: false, detail: CHIPAX_CONTRACT_BLOCKER, checkedAt }
    }
    return { ok: false, detail: "Operaciones de lectura pendientes de implementar contra el contrato.", checkedAt }
  }

  /**
   * Guarda explícita: cualquier intento de usar el proveedor antes de tener el
   * contrato falla ruidosamente en el backend en vez de devolver datos vacíos
   * que la UI mostraría como "no hay facturas".
   */
  assertUsable(): never {
    throw new BillingProviderError(CHIPAX_CONTRACT_BLOCKER, "CONTRACT_UNKNOWN", PROVIDER_ID)
  }
}
