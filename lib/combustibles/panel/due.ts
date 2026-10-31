import type { FuelInboxRow } from "@/lib/combustibles/inbox/types"
import { fuelInboxHref } from "@/lib/combustibles/routes"
import { todayInChile } from "@/lib/utils"
import { formatShortDay, waitingPhrase } from "./format"

/**
 * «Lo que vence primero»: cada fila de la bandeja, lista para dibujar. Es el
 * contrato entre el servidor (que arma las filas) y el Client Component que
 * marca lo nuevo: sólo lleva textos y enlaces, nada que el navegador tenga que
 * calcular con la hora (eso se hace acá, una sola vez, con el día civil de Chile).
 */
export interface PanelDueRow {
  key: string
  href: string
  /** Fecha límite corta: «31 oct». */
  dueLabel: string
  /** La fecha límite ya pasó: se pinta como vencida, no sólo como cercana. */
  overdue: boolean
  /** «CA-14 · KPRT·14»; vacío si lo pendiente no es de un equipo. */
  equipment: string
  /** «Lectura menor a la anterior». */
  title: string
  /** «Espera hace 6 días · 182.310 km; la carga anterior marcó 182.900 km». */
  detail: string
  /** Para decidir si es nuevo (`useInboxSeen`). */
  waitingSince: string
}

export function toPanelDueRow(row: FuelInboxRow, link: (href: string) => string = (href) => href, today = todayInChile()): PanelDueRow {
  const waiting = waitingPhrase(row.waitingSince, today)
  return {
    key: row.key,
    // La ficha de una carga o de un equipo no lleva el período; si la fila no tiene ficha propia, abre su caso en la bandeja.
    href: row.href ?? link(fuelInboxHref({ tipo: row.kind, item: row.key })),
    dueLabel: formatShortDay(row.dueDate, today),
    overdue: row.dueDate < today,
    equipment: row.equipmentLabel,
    title: row.title,
    detail: row.datum ? `${waiting} · ${row.datum}` : waiting,
    waitingSince: row.waitingSince,
  }
}

/**
 * Lo que le toca corregir a quien no decide: lo que su rol puede resolver
 * (`canAct`: permiso y alcance) y las cargas que registró ella misma y esperan
 * decisión, para que sepa qué quedó con una marca aunque la decida la jefatura.
 * Las claves de sus cargas son los ids de la carga y de su registro en terreno.
 */
export function pickRowsToFix(rows: readonly FuelInboxRow[], myLoadKeys: ReadonlySet<string>, limit: number): FuelInboxRow[] {
  return rows.filter((row) => row.canAct || (row.kind === "carga" && myLoadKeys.has(row.id))).slice(0, limit)
}
