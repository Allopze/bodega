import "server-only"
import type { Session } from "next-auth"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import type { FuelInboxFilters, FuelInboxItemDetail, FuelInboxPage, FuelInboxSummary } from "./types"

/**
 * Lectura de la bandeja «Por revisar». Contrato de la Fase 0: las firmas son
 * definitivas; los cuerpos los implementa la línea L4.
 */

/** Pendientes: todo lo cuyo mes del dato es ≤ fin del período (lo vencido sigue apareciendo). Decididas: decididas dentro del período. */
export async function getFuelInbox(session: Session, period: ResolvedFuelPeriod, filters: FuelInboxFilters): Promise<FuelInboxPage> {
  void session; void period
  // TODO(L4): unir los cuatro tipos, alcance por faena, orden `compareInboxRows`.
  return { rows: [], total: 0, page: filters.page, pageSize: filters.pageSize ?? 50 }
}

export async function summarizeFuelInbox(session: Session, period: ResolvedFuelPeriod): Promise<FuelInboxSummary> {
  void session; void period
  // TODO(L4): conteos por tipo con el mismo criterio de `getFuelInbox`.
  return { total: null, byKind: { carga: null, caso: null, patente: null, pedido: null }, oldestWaitingSince: null }
}

export async function getFuelInboxItem(session: Session, key: string): Promise<FuelInboxItemDetail | null> {
  void session; void key
  // TODO(L4): fila + evidencia por motivo + historial.
  return null
}
