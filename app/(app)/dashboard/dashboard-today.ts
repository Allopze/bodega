import { countOf, formatDate, todayInChile } from "@/lib/utils"
import { OPERATIONAL_MODULE_LABELS } from "@/lib/work-queue"
import type { OperationalWorkItem } from "@/lib/services/operational-work-queue"
import { scopedWorksiteId, type DashboardScope } from "./dashboard-scope"

/**
 * Datos del bloque "Hoy" de Inicio: lo más urgente de la cola de trabajo del
 * usuario, ya en lenguaje llano.
 *
 * La cola es la de `/pendientes` ("Mis pendientes" es su único nombre: es la
 * etiqueta del sidebar). Inicio sólo muestra un puñado y manda al resto allí;
 * ya no la replica en una vista propia (INI-07).
 */

/** Cuántas filas de la cola caben en "Hoy". Más ya es la cola, no un resumen. */
export const TODAY_ITEM_LIMIT = 5

export interface TodayItem {
  id: string
  title: string
  /** "Aprobaciones · Faena Norte": qué es y dónde. */
  context: string
  href: string
  ctaLabel: string
  /** "Vencida hace 74 días", "Vence hoy", "Vence en 3 días". */
  dueLabel: string
  due: "overdue" | "today" | "upcoming" | "none"
  critical: boolean
}

/**
 * Enlace a `/pendientes` que **conserva la faena** del alcance global.
 *
 * Sin esto, salir del dashboard con una faena elegida aterrizaba en
 * `/pendientes` sin filtro: el conteo del atajo y la lista de destino hablaban
 * de poblaciones distintas. `/pendientes` lee `worksiteId` de la URL
 * (`parseOperationalQueueFilters`), así que el filtro sobrevive al salto.
 */
export function pendientesHref(scope: DashboardScope, params: Record<string, string> = {}) {
  const search = new URLSearchParams(params)
  const worksiteId = scopedWorksiteId(scope)
  if (worksiteId) search.set("worksiteId", worksiteId)
  const query = search.toString()
  return query ? `/pendientes?${query}` : "/pendientes"
}

/** Días civiles entre dos "YYYY-MM-DD": positivo si `to` es posterior. */
function dayDiff(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/**
 * Vencimiento en palabras, contra el día civil chileno.
 *
 * Misma regla que la cola completa (`work-queue-workbench`): vencida es una
 * fecha de origen estrictamente anterior a hoy.
 */
export function describeDue(
  sourceDueAt: string | null,
  today: string,
): { label: string; due: TodayItem["due"] } {
  const day = sourceDueAt?.slice(0, 10) ?? ""
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { label: "Sin fecha de vencimiento", due: "none" }
  const diff = dayDiff(today, day)
  if (diff < 0) return { label: `Vencida hace ${countOf(-diff, "día", "días")}`, due: "overdue" }
  if (diff === 0) return { label: "Vence hoy", due: "today" }
  if (diff === 1) return { label: "Vence mañana", due: "upcoming" }
  if (diff <= 14) return { label: `Vence en ${diff} días`, due: "upcoming" }
  return { label: `Vence el ${formatDate(day)}`, due: "upcoming" }
}

const DUE_RANK: Record<TodayItem["due"], number> = { overdue: 0, today: 1, upcoming: 2, none: 3 }

/**
 * Las filas más urgentes: **vencidas primero** (la más atrasada arriba), luego
 * las críticas, luego la fecha de vencimiento más cercana.
 *
 * Recibe la unión de dos páginas de la cola —una ordenada por vencimiento y
 * otra por prioridad— porque ninguna sola alcanza: por vencimiento una crítica
 * sin fecha queda al final, y por prioridad una vencida normal queda detrás de
 * todas las críticas. Deduplica por id.
 */
export function pickTodayItems(
  items: readonly OperationalWorkItem[],
  today: string = todayInChile(),
  limit: number = TODAY_ITEM_LIMIT,
): TodayItem[] {
  const unique = new Map<string, OperationalWorkItem>()
  for (const item of items) if (!unique.has(item.id)) unique.set(item.id, item)

  return [...unique.values()]
    .map((item) => {
      const { label, due } = describeDue(item.sourceDueAt, today)
      const critical = item.priority === "critical"
      const worksite = item.worksiteName
      return {
        key: { due, critical, day: item.sourceDueAt?.slice(0, 10) ?? "9999-12-31", createdAt: item.createdAt, id: item.id },
        value: {
          id: item.id,
          title: item.title,
          context: [OPERATIONAL_MODULE_LABELS[item.module], worksite].filter(Boolean).join(" · "),
          href: item.href,
          ctaLabel: item.ctaLabel,
          dueLabel: item.blocked ? `Bloqueada · ${label}` : label,
          due,
          critical,
        } satisfies TodayItem,
      }
    })
    .sort((a, b) => {
      const overdue = Number(b.key.due === "overdue") - Number(a.key.due === "overdue")
      if (overdue !== 0) return overdue
      const critical = Number(b.key.critical) - Number(a.key.critical)
      if (critical !== 0) return critical
      if (a.key.day !== b.key.day) return a.key.day.localeCompare(b.key.day)
      return DUE_RANK[a.key.due] - DUE_RANK[b.key.due]
        || a.key.createdAt.localeCompare(b.key.createdAt)
        || a.key.id.localeCompare(b.key.id)
    })
    .slice(0, limit)
    .map((entry) => entry.value)
}

/** "Ver todos mis pendientes (215)"; sin el paréntesis cuando no hay nada. */
export function pendientesLinkLabel(total: number) {
  return total > 0 ? `Ver todos mis pendientes (${total})` : "Ver mis pendientes"
}
