import { formatQty } from "@/lib/utils"

/**
 * Lo que queda reservado para una OT sin usar: al conformarla o anularla pasa a stock libre de su faena
 * (ADR mantención 0001, D5). Es puro y serializable: la página lo calcula en el servidor y lo pasa a los diálogos.
 */
export type ReservedUnusedNotice = { count: number; worksiteNames: string[] }

type Reserved = { remaining: number; worksiteName: string }

export function reservedUnusedNotice(available: readonly Reserved[]): ReservedUnusedNotice | null {
  const open = available.filter((item) => item.remaining > 0)
  if (open.length === 0) return null
  const count = Math.round(open.reduce((sum, item) => sum + item.remaining, 0) * 100) / 100
  const worksiteNames = [...new Set(open.map((item) => item.worksiteName))]
  return { count, worksiteNames }
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "la faena"
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`
}

/** «Quedan 2 repuestos reservados sin usar; pasan a stock libre de Santa Fe.» */
export function reservedUnusedText(notice: ReservedUnusedNotice): string {
  const faena = joinNames(notice.worksiteNames)
  return notice.count === 1
    ? `Queda 1 repuesto reservado sin usar; pasa a stock libre de ${faena}.`
    : `Quedan ${formatQty(notice.count)} repuestos reservados sin usar; pasan a stock libre de ${faena}.`
}
