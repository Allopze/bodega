import { FLEET_STOPPED_FILTER } from "@/lib/fleet-overview-filters"
import { MAINTENANCE_OPEN_FILTER } from "@/lib/validation/maintenance"
import { countOf } from "@/lib/utils"
import type { OperationalAttention } from "@/lib/services/operational-control"
import { FUEL_INBOX_KINDS, type FuelInboxKind } from "@/lib/combustibles/inbox/types"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

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
  fuel: FUEL_PATHS.revisar,
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

/** Lo que espera en «Por revisar» (`getFuelInboxPendingByKind`); `null` si la consulta de ese tipo falló. */
export type FuelPendingCounts = Record<FuelInboxKind, number | null>

/** Cada tipo de pendiente contado en una frase («3 cargas por decidir») y, si su consulta falló, nombrado («Cargas por decidir: no se pudo calcular»). */
const FUEL_KIND_PHRASES: Record<FuelInboxKind, { singular: string; plural: string; label: string }> = {
  carga: { singular: "carga por decidir", plural: "cargas por decidir", label: "Cargas por decidir" },
  caso: { singular: "caso", plural: "casos", label: "Casos" },
  patente: { singular: "patente sin vincular", plural: "patentes sin vincular", label: "Patentes sin vincular" },
  pedido: { singular: "pedido de revisión", plural: "pedidos de revisión", label: "Pedidos de revisión" },
}

/**
 * Lo que espera a una persona en «Por revisar»: las cuatro colas, sin período, la
 * misma cifra del menú (y la del «Todo» de la bandeja mientras su período llegue
 * al último mes con datos). Un tipo cuya consulta falló se dice, no se suma como
 * 0: con uno caído el valor es «Sin dato», nunca un total parcial.
 */
export function fuelReviewTile(counts: FuelPendingCounts): AttentionTile {
  const label = "Combustible por revisar"
  const failed = FUEL_INBOX_KINDS.filter((kind) => counts[kind] === null)
  if (failed.length === FUEL_INBOX_KINDS.length) return unavailable("fuel", label)

  // Las partes en cero no se nombran; las que fallaron, sí.
  const parts = FUEL_INBOX_KINDS.flatMap((kind) => {
    const n = counts[kind]
    const phrase = FUEL_KIND_PHRASES[kind]
    if (n === null) return [`${phrase.label}: ${NOT_COMPUTED.toLowerCase()}`]
    return n > 0 ? [countOf(n, phrase.singular, phrase.plural)] : []
  })
  if (failed.length > 0) return unavailable("fuel", label, parts.join(" · "))
  if (parts.length === 0) {
    return { key: "fuel", label, value: "Al día", detail: "Nada espera a una persona", tone: "neutral", href: ATTENTION_HREFS.fuel }
  }
  return {
    key: "fuel",
    label,
    value: count(FUEL_INBOX_KINDS.reduce((sum, kind) => sum + (counts[kind] ?? 0), 0)),
    detail: parts.join(" · "),
    tone: "signal",
    href: ATTENTION_HREFS.fuel,
  }
}
