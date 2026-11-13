import { FLEET_STOPPED_FILTER } from "@/lib/fleet-overview-filters"
import { countOf, formatQty } from "@/lib/utils"
import type { OperationalAttention } from "@/lib/services/operational-control"
import { FUEL_INBOX_KINDS, type FuelInboxKind } from "@/lib/combustibles/inbox/types"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

/**
 * Los tiles de «Requiere atención». Cada uno es un enlace a **su
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
  /**
   * Una cifra es un `number` y `KpiCard` la formatea (es-CL, «2.246»); una
   * palabra («Ninguno», «Al día», «Sin dato») es un `string` con
   * `valueKind: "text"`, que se pinta como mensaje y no como un numeral enorme.
   */
  value: string | number
  valueKind: "number" | "text"
  detail: string
  tone: "neutral" | "signal" | "danger"
  href: string
}

export const ATTENTION_HREFS: Record<AttentionTileKey, string> & {
  /** El tile de documentos cambia de destino según lo que esté mirando: vencidos o por vencer. */
  documentsSoon: string
  documentsOk: string
} = {
  stopped: `/flota?estado=${FLEET_STOPPED_FILTER}`,
  workOrders: "/mantencion/ot?estado=abiertas",
  documents: "/flota?vencimiento=vencidos",
  documentsSoon: "/flota?vencimiento=proximos",
  documentsOk: "/flota?vencimiento=al-dia",
  fuel: FUEL_PATHS.revisar,
}

export const NOT_COMPUTED = "No se pudo calcular"
/** Valor de un tile cuya cifra no se pudo calcular: nunca un 0 que se lea como «no hay nada». */
const NO_DATA = "Sin dato"

/** Una cifra dentro de una frase del detalle («3 sin asignar»); el valor del tile va como número. */
const count = (n: number) => formatQty(n)

function unavailable(key: AttentionTileKey, label: string, detail = NOT_COMPUTED): AttentionTile {
  return { key, label, value: NO_DATA, valueKind: "text", detail, tone: "neutral", href: ATTENTION_HREFS[key] }
}

/** Equipos en mantención o fuera de servicio. `fleetSize` distingue «todo operativo» de «no hay equipos». */
export function stoppedTile(stopped: OperationalAttention["stoppedVehicles"], fleetSize: number): AttentionTile {
  const label = "Equipos detenidos"
  if (!stopped) return unavailable("stopped", label)
  if (stopped.total === 0) {
    return fleetSize === 0
      ? { key: "stopped", label, value: "Sin equipos", valueKind: "text", detail: "No hay equipos en las faenas a las que tienes acceso", tone: "neutral", href: ATTENTION_HREFS.stopped }
      : { key: "stopped", label, value: "Ninguno", valueKind: "text", detail: "Todo operativo", tone: "neutral", href: ATTENTION_HREFS.stopped }
  }
  return {
    key: "stopped",
    label,
    value: stopped.total,
    valueKind: "number",
    detail: `${count(stopped.inMaintenance)} en mantención · ${count(stopped.outOfService)} fuera de servicio`,
    tone: "signal",
    href: ATTENTION_HREFS.stopped,
  }
}

/**
 * Órdenes de trabajo abiertas (todo lo no cerrado ni anulado). El tile enlaza a
 * la lista con la pestaña «abiertas»: la cifra y las filas cuentan lo mismo.
 * El detalle dice cuántas esperan mecánico, cuántas tienen la entrega vencida y
 * cuántas esperan un repuesto, que es lo que alguien tiene que hacer. Sin un tile
 * propio para los repuestos (A1: tope de 4) y SIN cambiar el destino: el valor del
 * tile son todas las abiertas, así que el enlace sigue llevando a todas; llevarlo a
 * `?repuestos=pendientes` mostraría menos filas que la cifra (y `e2e/densidad-kpi`
 * declara este destino). El filtro se llega por URL y se quita desde su chip.
 */
export function workOrdersTile(workOrders: OperationalAttention["workOrders"]): AttentionTile {
  const label = "OT abiertas"
  if (!workOrders) return unavailable("workOrders", label)
  if (workOrders.openCount === 0) {
    return { key: "workOrders", label, value: "Ninguna", valueKind: "text", detail: "Sin órdenes de trabajo abiertas", tone: "neutral", href: ATTENTION_HREFS.workOrders }
  }
  const parts = [
    workOrders.unassignedOpen > 0 ? `${count(workOrders.unassignedOpen)} sin asignar` : "Todas con mecánico",
    ...(workOrders.estimateOverdue > 0 ? [`${count(workOrders.estimateOverdue)} con entrega vencida`] : []),
    ...(workOrders.waitingParts > 0 ? [`${count(workOrders.waitingParts)} esperando repuesto`] : []),
  ]
  return {
    key: "workOrders",
    label,
    value: workOrders.openCount,
    valueKind: "number",
    detail: parts.join(" · "),
    tone: workOrders.unassignedOpen > 0 || workOrders.estimateOverdue > 0 || workOrders.waitingParts > 0 ? "signal" : "neutral",
    href: ATTENTION_HREFS.workOrders,
  }
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
      valueKind: "text",
      detail: expiringSoon > 0 ? `${countOf(expiringSoon, "equipo")} por vencer en ${plazo}` : `Nada por vencer en ${plazo}`,
      tone: "neutral",
      // La cifra del tile y la lista que abre tienen que contar lo mismo: si no
      // hay vencidos y sí próximos, el enlace va a «próximos», no a «vencidos».
      href: expiringSoon > 0 ? ATTENTION_HREFS.documentsSoon : ATTENTION_HREFS.documentsOk,
    }
  }
  return {
    key: "documents",
    label,
    value: expired,
    valueKind: "number",
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

/** Las colas que una persona resuelve con un gesto; los casos abiertos son seguimiento y van aparte. */
const FUEL_ACTION_KINDS = ["carga", "patente", "pedido"] as const satisfies readonly FuelInboxKind[]

/** El seguimiento de casos abiertos: en prod son mayormente meses cerrados, no trabajo del día. */
const FUEL_FOLLOW_UP_PHRASE = { singular: "caso en seguimiento", plural: "casos en seguimiento" }

/**
 * Lo que espera a una persona en «Por revisar» (las cuatro colas, sin período).
 *
 * La cifra principal es lo que se resuelve ahora: cargas por decidir, patentes
 * sin vincular y pedidos de revisión. Los casos abiertos van en el detalle con
 * su nombre («482 casos en seguimiento»): sumarlos escondía 10 cargas del mes
 * detrás de un 492 que casi todo era histórico (auditoría 2026-11-13, P2). Un
 * tipo cuya consulta falló se dice, no se suma como 0: con uno caído el valor es
 * «Sin dato», nunca un total parcial.
 */
export function fuelReviewTile(counts: FuelPendingCounts): AttentionTile {
  const label = "Combustible por revisar"
  const failed = FUEL_INBOX_KINDS.filter((kind) => counts[kind] === null)
  if (failed.length === FUEL_INBOX_KINDS.length) return unavailable("fuel", label)

  // Las partes en cero no se nombran; las que fallaron, sí. Las colas de acción van antes que el seguimiento.
  const phraseOf = (kind: FuelInboxKind) => {
    const n = counts[kind]
    const phrase = FUEL_KIND_PHRASES[kind]
    if (n === null) return [`${phrase.label}: ${NOT_COMPUTED.toLowerCase()}`]
    if (n === 0) return []
    return [kind === "caso" ? countOf(n, FUEL_FOLLOW_UP_PHRASE.singular, FUEL_FOLLOW_UP_PHRASE.plural) : countOf(n, phrase.singular, phrase.plural)]
  }
  const parts = [...FUEL_ACTION_KINDS.flatMap(phraseOf), ...phraseOf("caso")]
  if (failed.length > 0) return unavailable("fuel", label, parts.join(" · "))
  if (parts.length === 0) {
    return { key: "fuel", label, value: "Al día", valueKind: "text", detail: "Nada espera a una persona", tone: "neutral", href: ATTENTION_HREFS.fuel }
  }
  const actionable = FUEL_ACTION_KINDS.reduce((sum, kind) => sum + (counts[kind] ?? 0), 0)
  if (actionable === 0) {
    return { key: "fuel", label, value: "Nada por decidir", valueKind: "text", detail: parts.join(" · "), tone: "signal", href: ATTENTION_HREFS.fuel }
  }
  return {
    key: "fuel",
    label,
    value: actionable,
    valueKind: "number",
    detail: parts.join(" · "),
    tone: "signal",
    href: ATTENTION_HREFS.fuel,
  }
}
