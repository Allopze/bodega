import { ShareBar, type ShareSegment } from "@/components/charts/share-bar"
import { ChartSection } from "@/components/charts/chart-section"
import { pluralize } from "@/lib/utils"
import { summarizeStatusDistribution } from "@/lib/services/trazabilidad-consolidated-builder"
import type { StatusDistributionEntry, StatusMeta } from "@/lib/services/trazabilidad-consolidated.types"

/**
 * El tono de la insignia de cada estado, como relleno de la barra. Es el mismo
 * vocabulario de color que ya muestra la tabla (`COMPUTED_STATUS_METAS`): un
 * estado usa los semánticos, no la serie categórica. Varios estados comparten
 * tono (las cinco etapas «info» van seguidas); por eso cada segmento va separado
 * por un hueco y la leyenda nombra y cuenta cada uno.
 */
const TONE_FILL: Record<StatusMeta["color"], string> = {
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  info: "var(--color-info)",
  signal: "var(--color-signal)",
  danger: "var(--color-danger)",
  neutral: "var(--color-chart-reference)",
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

  const segments: ShareSegment[] = distribution.map((entry) => ({
    key: entry.status,
    label: entry.label,
    count: entry.count,
    color: TONE_FILL[entry.color],
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
