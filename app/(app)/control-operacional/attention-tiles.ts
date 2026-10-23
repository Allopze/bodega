import { FLEET_STOPPED_FILTER } from "@/lib/fleet-overview-filters"
import { MAINTENANCE_OPEN_FILTER } from "@/lib/validation/maintenance"
import { countOf } from "@/lib/utils"
import type { OperationalAttention } from "@/lib/services/operational-control"

/**
 * Los cuatro tiles de «Requiere atención». Cada uno es un enlace a **su
 * subconjunto**, no al total (A1): la cifra del tile y las filas de la lista que
 * abre cuentan lo mismo. Los destinos viven aquí, junto al texto, para que quien
 * cambie uno vea el otro.
 *
 * Es un módulo de datos puro: la página sólo le pone ícono y `KpiCard`.
 */

export type AttentionTileKey = "stopped" | "workOrders" | "documents" | "fuel"

export interface AttentionTile {
  key: AttentionTileKey
  label: string
  value: string
  detail: string
  tone: "neutral" | "signal" | "danger"
  href: string
}

export const ATTENTION_HREFS: Record<AttentionTileKey, string> = {
  stopped: `/flota?estado=${FLEET_STOPPED_FILTER}`,
  workOrders: `/mantenciones?status=${MAINTENANCE_OPEN_FILTER}`,
  documents: "/flota?vencimiento=vencidos",
  fuel: "/combustibles/revision",
}

export const NOT_COMPUTED = "No se pudo calcular"
/** Valor de un tile cuya cifra no se pudo calcular: nunca un 0 que se lea como «no hay nada». */
const NO_DATA = "Sin dato"

const count = (n: number) => n.toLocaleString("es-CL")

function unavailable(key: AttentionTileKey, label: string, detail = NOT_COMPUTED): AttentionTile {
  return { key, label, value: NO_DATA, detail, tone: "neutral", href: ATTENTION_HREFS[key] }
}

/** Equipos en mantención o fuera de servicio. `fleetSize` distingue «todo operativo» de «no hay equipos». */
export function stoppedTile(stopped: OperationalAttention["stoppedVehicles"], fleetSize: number): AttentionTile {
  const label = "Equipos detenidos"
  if (!stopped) return unavailable("stopped", label)
  if (stopped.total === 0) {
    return fleetSize === 0
      ? { key: "stopped", label, value: "Sin equipos", detail: "No hay equipos en las faenas a las que tienes acceso", tone: "neutral", href: ATTENTION_HREFS.stopped }
      : { key: "stopped", label, value: "Ninguno", detail: "Todo operativo", tone: "neutral", href: ATTENTION_HREFS.stopped }
  }
  return {
    key: "stopped",
    label,
    value: count(stopped.total),
    detail: `${count(stopped.inMaintenance)} en mantención · ${count(stopped.outOfService)} fuera de servicio`,
    tone: "signal",
    href: ATTENTION_HREFS.stopped,
  }
}

/** OT programadas o en curso, de todas las fechas: es «ahora», no el backlog del período. */
export function workOrdersTile(openWorkOrders: OperationalAttention["openWorkOrders"]): AttentionTile {
  const label = "OT abiertas"
  if (openWorkOrders === null) return unavailable("workOrders", label)
  if (openWorkOrders === 0) {
    return { key: "workOrders", label, value: "Ninguna", detail: "Sin OT programadas ni en curso", tone: "neutral", href: ATTENTION_HREFS.workOrders }
  }
  return { key: "workOrders", label, value: count(openWorkOrders), detail: "Programadas o en curso", tone: "neutral", href: ATTENTION_HREFS.workOrders }
}

/** Equipos con algún documento vencido; el detalle dice cuántos más vencen dentro de la ventana de aviso de Flota. */
export function documentsTile(documents: OperationalAttention["fleetDocuments"]): AttentionTile {
  const label = "Documentos vencidos"
  if (!documents) return unavailable("documents", label)
  const { expired, expiringSoon, warningDays } = documents
  const plazo = `${count(warningDays)} días`
  if (expired === 0) {
    return {
      key: "documents",
      label,
      value: "Ninguno",
      detail: expiringSoon > 0 ? `${countOf(expiringSoon, "equipo")} por vencer en ${plazo}` : `Nada por vencer en ${plazo}`,
      tone: "neutral",
      href: ATTENTION_HREFS.documents,
    }
  }
  return {
    key: "documents",
    label,
    value: count(expired),
    detail: `Equipos con documentos vencidos · ${expiringSoon > 0 ? `${count(expiringSoon)} por vencer en ${plazo}` : `ninguno por vencer en ${plazo}`}`,
    tone: "danger",
    href: ATTENTION_HREFS.documents,
  }
}

const flaggedLoads = (n: number) => countOf(n, "carga marcada", "cargas marcadas")
const anomalies = (n: number) => countOf(n, "anomalía", "anomalías")

/** Las dos colas de «Revisión». Un conteo que falló se dice, no se pinta como 0. */
export function fuelReviewTile(counts: { flagged: number | null; anomalies: number | null }): AttentionTile {
  const label = "Combustible por revisar"
  const { flagged, anomalies: open } = counts
  if (flagged === null && open === null) return unavailable("fuel", label)
  if (flagged === null || open === null) {
    return unavailable(
      "fuel",
      label,
      flagged === null
        ? `Cargas marcadas: ${NOT_COMPUTED.toLowerCase()} · ${anomalies(open!)}`
        : `${flaggedLoads(flagged)} · anomalías: ${NOT_COMPUTED.toLowerCase()}`,
    )
  }
  if (flagged + open === 0) {
    return { key: "fuel", label, value: "Al día", detail: "Sin cargas marcadas ni anomalías", tone: "neutral", href: ATTENTION_HREFS.fuel }
  }
  return {
    key: "fuel",
    label,
    value: count(flagged + open),
    detail: `${flaggedLoads(flagged)} · ${anomalies(open)}`,
    tone: "signal",
    href: ATTENTION_HREFS.fuel,
  }
}
