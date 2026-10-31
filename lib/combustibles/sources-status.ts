import "server-only"
import type { Session } from "next-auth"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"

/**
 * Estado de cada fuente de datos de Combustible, en palabras (pantalla
 * «Fuentes de datos» y paso 1 del Panel). Contrato de la Fase 0; el cuerpo lo
 * implementa la línea L8.
 */
export type FuelSourceKey = "copec" | "aramco" | "planilla" | "telemetria" | "surtidor" | "terreno" | "historico-sellos" | "facturas"

export interface FuelSourceStatus {
  key: FuelSourceKey
  name: string
  description: string
  /** `pendiente`: falta algo que una persona puede resolver; `falla`: la última corrida falló. */
  status: "ok" | "pendiente" | "falla" | "sin_datos"
  /** «Al día», «Hasta ayer», «Importada el 28 oct», «Falló hoy a las 05:30». */
  statusLabel: string
  lastUpdateAt: string | null
  facts: { label: string; value: string }[]
  /** Pantallas que usan esta fuente. */
  feeds: string[]
  /** Lo que falta resolver, en una frase, o `null`. */
  problem: string | null
  /** Detalle técnico plegado (cobertura por mes, calidad de la corrida…). */
  technical: string[]
}

export async function getFuelSourceStatuses(session: Session, period: ResolvedFuelPeriod): Promise<FuelSourceStatus[]> {
  void session; void period
  // TODO(L8): Copec, Aramco, getCronJobHealth, últimos lotes de las 4 tablas, último QR.
  return []
}

/** Resumen para el Panel: listo si ninguna fuente está pendiente ni falló. */
export function summarizeFuelSources(statuses: readonly FuelSourceStatus[]): { ready: boolean; pending: FuelSourceStatus[] } {
  const pending = statuses.filter((status) => status.status === "pendiente" || status.status === "falla")
  return { ready: statuses.length > 0 && pending.length === 0, pending }
}
