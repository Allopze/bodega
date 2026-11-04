import { ShareBar, type ShareSegment } from "@/components/charts/share-bar"
import { ChartSection } from "@/components/charts/chart-section"
import { pluralize } from "@/lib/utils"
import { summarizeStatusDistribution } from "@/lib/services/trazabilidad-consolidated-builder"
import type { StatusDistributionEntry } from "@/lib/services/trazabilidad-consolidated.types"

/**
 * Color de cada estado en la barra.
 *
 * La primera versión usaba el tono de la insignia de la tabla, pero esos tonos se
 * repiten: «Pedido a proveedor», «Enviado a faena» y «En faena» salían del mismo
 * azul y «Aprobado» y «En oficina» del mismo naranjo, uno al lado del otro, y la
 * barra no dejaba ver dónde terminaba una etapa (recorrido del 2026-11-03).
 *
 * Lo que la barra cuenta es **cuánto avanzó** cada solicitud, así que las etapas
 * en curso van en una rampa de un solo matiz, de clara (recién aprobada) a oscura
 * (casi entregada), en el orden del ciclo de vida. Los cierres sí son estados con
 * significado propio: entregado en `success`, rechazado en `danger`, cancelado y
 * borrador en gris de referencia. La leyenda nombra y cuenta cada parte.
 */
const CLOSED_FILL: Record<string, string> = {
  entregado: "var(--color-success)",
  rechazado: "var(--color-danger)",
  cancelado: "var(--color-chart-reference)",
  borrador: "var(--color-chart-reference)",
}

export function lifecycleFills(statuses: readonly string[]): string[] {
  const open = statuses.filter((status) => !(status in CLOSED_FILL))
  return statuses.map((status) => {
    if (status in CLOSED_FILL) return CLOSED_FILL[status]!
    const index = open.indexOf(status)
    // De 35 % a 100 % de chart-2 sobre la superficie: OKLab y no OKLCH: la superficie no tiene matiz y OKLCH giraría hacia el rosa.
    const share = open.length === 1 ? 100 : Math.round(35 + (65 * index) / (open.length - 1))
    return share === 100 ? "var(--color-chart-2)" : `color-mix(in oklab, var(--color-chart-2) ${share}%, var(--color-surface))`
  })
}

/** Cada segmento lleva a la lista de ese estado; el elegido, otra vez, es la salida. */
function estadoHref(searchParams: Record<string, string | string[] | undefined>, estado: string): string {
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(searchParams)) {
    if (name === "page" || name === "estado") continue
    if (Array.isArray(value)) for (const item of value) params.append(name, item)
    else if (value) params.set(name, value)
  }
  if (estado) params.set("estado", estado)
  const query = params.toString()
  return query ? `/seguimiento?${query}` : "/seguimiento"
}

/**
 * CHART-031 · Cómo se reparten las solicitudes entre las etapas de su vida.
 *
 * Reemplaza a cuatro tiles y una tira que medían unidades distintas (solicitudes,
 * OC) y se solapaban —una solicitud podía estar en varias etapas a la vez—, de
 * modo que parecían sumar el total y no lo sumaban. Esta barra sí: usa el estado
 * agregado de cada solicitud (`ConsolidatedRequest.status`), que es excluyente.
 *
 * Va de Borrador a Entregado, y al final Rechazado y Cancelado. Cada segmento y
 * cada rótulo de la leyenda lleva a `?estado=` y el elegido se marca. Cuenta con
 * todos los filtros menos el de estado, porque es su selector.
 */
export function ConsolidatedStatusChart({
  distribution,
  estado,
  searchParams,
  filtered = false,
}: {
  distribution: StatusDistributionEntry[]
  /** Valor vigente del filtro de estado (ya normalizado; por defecto `en_curso`). */
  estado: string
  searchParams: Record<string, string | string[] | undefined>
  /**
   * Hay filtros distintos del de estado: la distribución resume lo filtrado, no
   * la faena completa, y conviene decirlo.
   */
  filtered?: boolean
}) {
  const { total, open, closed } = summarizeStatusDistribution(distribution)
  if (total === 0) return null

  const shown = distribution.filter((entry) => entry.count > 0)
  const fills = lifecycleFills(shown.map((entry) => entry.status))
  const segments: ShareSegment[] = shown.map((entry, index) => ({
    key: entry.status,
    label: entry.label,
    count: entry.count,
    color: fills[index]!,
    active: estado === entry.status,
    href: estadoHref(searchParams, estado === entry.status ? "" : entry.status),
  }))

  return (
    <ChartSection
      title="Solicitudes por estado"
      summary={
        <>
          {total.toLocaleString("es-CL")} {pluralize(total, "solicitud")}: {open.toLocaleString("es-CL")} en curso y{" "}
          {closed.toLocaleString("es-CL")} {pluralize(closed, "cerrada")} (entregadas, rechazadas o canceladas).
          {filtered && " Cuenta las que pasan los filtros aplicados, no la faena completa."}
        </>
      }
    >
      <ShareBar label="Solicitudes por estado" noun="solicitud" segments={segments} inPlace />
    </ChartSection>
  )
}
