import { FUEL_LOAD_STATUS_LABELS } from "@/lib/combustibles/labels"
import { SERVICE_TYPE_LABELS } from "@/lib/combustibles/source-labels"

/**
 * Parámetros de URL de «Pagos › Facturas» y las palabras con que se muestran.
 * Sin dependencias de servidor: lo importan la página, los filtros del cliente
 * y la exportación.
 *
 * Los nombres de antes del rediseño (`service`, `vehicle`, `status`, `page`)
 * siguen valiendo: `/combustibles/facturas?status=draft` llega aquí tal cual
 * desde la página puente y no debe perder el filtro en silencio.
 */

export const INVOICE_PAGE_SIZE = 50

/** El tipo de tarjeta de la carga, con el nombre del glosario (no las siglas TCT / TAE). */
export { SERVICE_TYPE_LABELS }

export const INVOICE_FILTER_KEYS = ["faena", "equipo", "estado", "servicio", "proveedor", "producto", "productoId"] as const

export interface InvoiceListParams {
  q: string
  faena: string
  equipo: string
  estado: string
  servicio: string
  proveedor: string
  producto: string
  productoId: string
  pagina: number
}

type SearchParams = Record<string, string | string[] | undefined>

function first(sp: SearchParams, ...keys: string[]): string {
  for (const key of keys) {
    const raw = sp[key]
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim()
    if (value) return value
  }
  return ""
}

export function parseInvoiceParams(sp: SearchParams): InvoiceListParams {
  const estado = first(sp, "estado", "status")
  const servicio = first(sp, "servicio", "service")
  const page = Number.parseInt(first(sp, "pagina", "page"), 10)
  return {
    q: first(sp, "q"),
    faena: first(sp, "faena"),
    equipo: first(sp, "equipo", "vehicle"),
    estado: Object.hasOwn(FUEL_LOAD_STATUS_LABELS, estado) ? estado : "",
    servicio: Object.hasOwn(SERVICE_TYPE_LABELS, servicio) ? servicio : "",
    proveedor: first(sp, "proveedor"),
    producto: first(sp, "producto"),
    productoId: first(sp, "productoId"),
    pagina: Number.isFinite(page) && page > 0 ? page : 1,
  }
}

/** «CM-11 · AA-BB-11», o sólo la patente si el equipo no tiene código interno. */
export function invoiceEquipmentLabel(vehicle: { code: string | null; plate: string } | null): string {
  if (!vehicle) return "—"
  return vehicle.code ? `${vehicle.code} · ${vehicle.plate}` : vehicle.plate
}
