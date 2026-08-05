/**
 * lib/services/billing/providers/index.ts
 *
 * Registro de proveedores de facturación.
 *
 * El resto del sistema pide un proveedor por id y pregunta por sus capacidades.
 * Nadie fuera de esta carpeta importa `DtePortalClient` ni sabe que FacturaEnLínea
 * es scraping: eso es exactamente lo que permite migrar o agregar un proveedor
 * sin tocar el módulo.
 */

import type { BillingProviderId } from "@/db/schema"
import type { BillingProvider } from "./types"
import { FacturaEnLineaProvider } from "./factura-en-linea"
import { ChipaxProvider } from "./chipax"
import { ManualProvider } from "./manual"
import { readChipaxConfig } from "../config"

export * from "./types"
export { FacturaEnLineaProvider, FACTURA_EN_LINEA_CAPABILITIES } from "./factura-en-linea"
export { ChipaxProvider, CHIPAX_CAPABILITIES, CHIPAX_CONTRACT_BLOCKER } from "./chipax"
export { ManualProvider, MANUAL_CAPABILITIES, providerInvoiceFromXml } from "./manual"

/** Orden estable para la pantalla de sincronización. */
export const BILLING_PROVIDER_IDS: readonly BillingProviderId[] = [
  "factura_en_linea",
  "chipax",
  "manual",
] as const

/**
 * Construye un proveedor. Se instancia por llamada en vez de mantener un
 * singleton: cada corrida quiere su propio cliente HTTP con su propio throttle,
 * y un singleton compartido entre requests concurrentes serializaría de más.
 */
export function getBillingProvider(id: BillingProviderId): BillingProvider {
  switch (id) {
    case "factura_en_linea": return new FacturaEnLineaProvider()
    case "chipax":           return new ChipaxProvider()
    case "manual":           return new ManualProvider()
  }
}

export function getAllBillingProviders(): BillingProvider[] {
  return BILLING_PROVIDER_IDS.map(getBillingProvider)
}

/**
 * True si el proveedor está habilitado por feature flag.
 *
 * FacturaEnLínea y la carga manual están siempre habilitados (el primero ya
 * opera en producción para Compras). Chipax está detrás de su flag y además
 * exige contrato verificado, que es un requisito distinto de "encendido".
 */
export function isProviderEnabled(id: BillingProviderId): boolean {
  if (id !== "chipax") return true
  // Ya no hay un segundo interruptor de "contrato verificado": el contrato se
  // leyó y las operaciones están implementadas contra él. Queda el feature flag.
  return readChipaxConfig().enabled
}

/**
 * Verifica que un proveedor declare la capacidad y además implemente el método.
 * Una capacidad en `true` sin método es un bug de programación, no una condición
 * de runtime: se detecta acá y en `__tests__/providers.test.ts`.
 */
export function assertCapability(
  provider: BillingProvider,
  capability: keyof BillingProvider["capabilities"],
  method: keyof BillingProvider,
): void {
  if (!provider.capabilities[capability]) {
    throw new Error(`${provider.label} no declara la capacidad ${capability}.`)
  }
  if (typeof provider[method] !== "function") {
    throw new Error(`${provider.label} declara ${capability} pero no implementa ${String(method)}.`)
  }
}
