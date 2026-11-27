import { formatDate } from "@/lib/utils"

/**
 * Tipos y reglas PURAS de la ficha de un equipo en Preventivo («qué se hizo y qué no»). Las usa el cargador
 * (`equipment-check-detail.ts`, con base de datos) y la ficha (cliente): este módulo no importa nada del servidor.
 */

export type ItemState = "realizado" | "no_realizado" | "no_aplica"

export interface DetailItem {
  name: string
  /** Sistema del ítem. `null` en el histórico (el consolidado no lo trae) salvo que la pauta vigente lo diga sin dudas. */
  system: string | null
  state: ItemState
  /** Motivo de un «no realizado». Sólo el registro de la plataforma lo pide; el histórico no lo trae y NUNCA se inventa. */
  reason: string | null
}

/** Una foto de evidencia (filtros o sticker) de una pauta. */
export type CheckPhoto =
  | { status: "missing" }
  /** Foto de la plataforma: se abre en el visor de siempre. */
  | { status: "native"; id: string; stampedAt: string; receivedAt: string }
  /** Enlace de respaldo del formulario (Drive). */
  | { status: "link"; url: string }
  /** El formulario trae un texto que no es un enlace a Drive/Docs: no se ofrece como enlace. */
  | { status: "invalid_link" }

/** Una pauta del período, para la lista de pestañas de la ficha. */
export interface PeriodCheck {
  /** `h:<sourceKey>` o `r:<recordId>`: el mismo id que usa `pauta=` y `x_check`. */
  id: string
  source: "historial" | "registro"
  date: string
  level: string
  mechanic: string | null
  done: number
  notDone: number
  notApplicable: number
  percent: number | null
  /** Folio del registro firmado (sólo nativo). */
  folio: string | null
  /** Id del registro (sólo nativo): lleva a su página. */
  recordId: string | null
}

export interface CheckDetail extends PeriodCheck {
  reading: number | null
  observations: string | null
  /**
   * `full`: todos los ítems; `not_done_only`: el formulario no trae el detalle por ítem pero sí los nombres de los
   * no realizados; `none`: no trae detalle.
   */
  itemDetail: "full" | "not_done_only" | "none"
  items: DetailItem[]
  filtersPhoto: CheckPhoto
  stickerPhoto: CheckPhoto
}

/** Un ítem que no se hizo en alguna pauta del período. */
export interface PendingItem {
  name: string
  system: string | null
  /** Pautas en que no se hizo. */
  notDoneCount: number
  /** Pautas en que el ítem aplicaba (realizado o no realizado; «no aplica» no cuenta). */
  applicableCount: number
  /** Fechas de las pautas en que no se hizo, de la más reciente a la más antigua. */
  dates: string[]
  /** En la pauta más reciente donde aplicaba, sí se hizo. */
  doneSince: boolean
}

export interface EquipmentCheckDetail {
  vehicle: { id: string; code: string; plate: string; typeName: string | null; worksiteName: string | null }
  period: { from: string; to: string }
  /** Las pautas del período, la más reciente primero. */
  checks: PeriodCheck[]
  pending: PendingItem[]
  /** La pauta pedida o, sin pedido válido, la más reciente. `null` sin pautas. */
  selected: CheckDetail | null
}

/**
 * Los ítems que no se hicieron en alguna pauta del período, con su sistema y cuántas veces. Orden: más repeticiones
 * primero; a igual cantidad, el no realizado más reciente y luego el nombre. Un ítem se identifica por su nombre
 * (el histórico no trae clave).
 */
export function pendingItems(checks: ReadonlyArray<{ date: string; items: readonly DetailItem[] }>): PendingItem[] {
  const newestFirst = [...checks].sort((a, b) => b.date.localeCompare(a.date))
  const byName = new Map<string, PendingItem & { latestApplicableDone: boolean | null }>()
  for (const check of newestFirst) {
    for (const item of check.items) {
      if (item.state === "no_aplica") continue
      const current = byName.get(item.name) ?? {
        name: item.name, system: null, notDoneCount: 0, applicableCount: 0, dates: [], doneSince: false, latestApplicableDone: null,
      }
      current.applicableCount += 1
      if (!current.system && item.system) current.system = item.system
      if (current.latestApplicableDone === null) current.latestApplicableDone = item.state === "realizado"
      if (item.state === "no_realizado") current.dates.push(check.date)
      byName.set(item.name, current)
    }
  }
  return [...byName.values()]
    .filter((item) => item.dates.length > 0)
    .map(({ latestApplicableDone, ...item }) => ({ ...item, notDoneCount: item.dates.length, doneSince: latestApplicableDone === true }))
    .sort((a, b) => b.notDoneCount - a.notDoneCount || (b.dates[0] ?? "").localeCompare(a.dates[0] ?? "") || a.name.localeCompare(b.name, "es"))
}

/** «No se hizo el 15-09-2026» (una vez) o «No se hizo en 2 de 5 pautas». */
export function pendingText(item: PendingItem): string {
  const base = item.notDoneCount === 1 && item.dates[0]
    ? `No se hizo el ${formatDate(item.dates[0])}`
    : `No se hizo en ${item.notDoneCount} de ${item.applicableCount} pautas`
  return item.doneSince ? `${base}; después sí se hizo` : base
}

export const NO_SYSTEM = "Sin sistema"

export interface GroupedItems {
  /** Lo que no se hizo, primero. */
  notDone: DetailItem[]
  /** Lo hecho, por sistema, en el orden en que aparece (sin sistema al final). */
  doneBySystem: Array<{ system: string; items: DetailItem[] }>
  notApplicable: DetailItem[]
}

export function groupItems(items: readonly DetailItem[]): GroupedItems {
  const notDone = items.filter((item) => item.state === "no_realizado")
  const notApplicable = items.filter((item) => item.state === "no_aplica")
  const groups = new Map<string, DetailItem[]>()
  for (const item of items) {
    if (item.state !== "realizado") continue
    const key = item.system ?? NO_SYSTEM
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  const doneBySystem = [...groups.entries()]
    .map(([system, list]) => ({ system, items: list }))
    .sort((a, b) => Number(a.system === NO_SYSTEM) - Number(b.system === NO_SYSTEM))
  return { notDone, doneBySystem, notApplicable }
}

/**
 * El sistema de un ítem del histórico, tomado de la pauta VIGENTE del equipo sólo si el nombre coincide exacto con
 * UN ítem de la pauta (si aparece en dos sistemas no se adivina: queda sin sistema).
 */
export function systemResolver(groups: ReadonlyArray<{ name: string; items: ReadonlyArray<{ name: string }> }>): (itemName: string) => string | null {
  const systems = new Map<string, Set<string>>()
  for (const group of groups) {
    for (const item of group.items) systems.set(item.name, new Set([...(systems.get(item.name) ?? []), group.name]))
  }
  return (itemName) => {
    const found = systems.get(itemName)
    return found && found.size === 1 ? [...found][0]! : null
  }
}
