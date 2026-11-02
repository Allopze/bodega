import type { WorkOrderDetail, WorkOrderListRow } from "./types"
import type { OtStatus } from "@/lib/mantencion/work-order-states"
import type { MantViewer } from "@/lib/services/mantencion/access"

/**
 * Fase 0: firmas fijas de lectura. Implementa L1; consume L3 (lista, detalle,
 * PDF y Excel) y L4 (métricas).
 */

/** Pestañas de la lista (StageTabs, `?estado=`). `abiertas` agrupa todo lo no cerrado ni anulado. */
export const WORK_ORDER_TABS = ["abiertas", "solicitada", "asignada", "en_ejecucion", "trabajo_terminado", "recepcionada", "cerrada", "anulada"] as const
export type WorkOrderTab = (typeof WORK_ORDER_TABS)[number]

export interface WorkOrderListFilters {
  tab: WorkOrderTab
  worksiteId?: string
  vehicleId?: string
  assignedToUserId?: string
  /** Período sobre la fecha de la OT (`request_date`), YYYY-MM-DD. */
  from?: string
  to?: string
  /** Búsqueda en el servidor: folio, código o patente del equipo, solicitante. */
  q?: string
  page: number
  pageSize: number
}

export interface WorkOrderListResult {
  rows: WorkOrderListRow[]
  total: number
  /** Conteo por pestaña con los mismos filtros (sin la pestaña). */
  counts: Record<WorkOrderTab, number>
}

export async function listWorkOrders(_viewer: MantViewer, _filters: WorkOrderListFilters): Promise<WorkOrderListResult> {
  throw new Error("listWorkOrders: no implementado (fase 0)")
}

export interface WorkOrderFilterOptions {
  worksites: Array<{ id: string; name: string }>
  mechanics: Array<{ id: string; name: string }>
}

export async function loadWorkOrderFilterOptions(_viewer: MantViewer): Promise<WorkOrderFilterOptions> {
  throw new Error("loadWorkOrderFilterOptions: no implementado (fase 0)")
}

/** Equipos sobre los que el usuario puede crear una OT (su alcance; un rol global, todos). */
export interface WorkOrderEquipmentOption {
  id: string
  code: string
  plate: string
  typeName: string
  worksiteId: string
  worksiteName: string
  unit: "km" | "h"
}

export async function listWorkOrderEquipmentOptions(_viewer: MantViewer): Promise<WorkOrderEquipmentOption[]> {
  throw new Error("listWorkOrderEquipmentOptions: no implementado (fase 0)")
}

/** Mecánicos asignables: activos con `mant:ot:execute`, de TODAS las faenas. */
export async function listAssignableMechanics(): Promise<Array<{ id: string; name: string; worksiteNames: string[] }>> {
  throw new Error("listAssignableMechanics: no implementado (fase 0)")
}

/** Talleres externos y conductores/operadores para el formulario de ingreso. */
export async function loadWorkOrderEntryCatalogs(): Promise<{ workshops: Array<{ id: string; name: string }>; drivers: Array<{ id: string; name: string }> }> {
  throw new Error("loadWorkOrderEntryCatalogs: no implementado (fase 0)")
}

/** `null` si no existe o está fuera del alcance (la página responde notFound). */
export async function loadWorkOrderDetail(_viewer: MantViewer, _id: string): Promise<WorkOrderDetail | null> {
  throw new Error("loadWorkOrderDetail: no implementado (fase 0)")
}

/** Para el selector de estado de la exportación y la línea de tiempo. */
export type { OtStatus }
