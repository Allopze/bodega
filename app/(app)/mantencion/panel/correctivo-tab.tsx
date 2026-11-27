import { CorrectivePanel } from "@/components/mantencion/panel/looker/corrective-panel"
import { buildPaginationHref } from "@/lib/pagination"
import type { MantViewer } from "@/lib/services/mantencion/access"
import { loadCorrectivePage } from "@/lib/services/mantencion/looker/corrective"
import { loadCorrectiveTabData } from "@/lib/services/mantencion/looker/corrective-tab-data"
import { queryFilters } from "@/lib/services/mantencion/looker/filters"
import type { LookerContext } from "@/lib/services/mantencion/looker/types"

const PANEL = "/mantencion/panel"

/**
 * Pestaña Correctivo de una unidad (`unidad`): los trabajos de mantención correctiva, de a una columna. Los cargadores
 * (`loadCorrectiveTabData`) deciden qué dimensión ignora cada bloque; aquí sólo se juntan con la tabla paginada y se
 * calcula el «de N controlados» de la tira con los mismos filtros de faena y equipo que acotan los trabajos.
 */
export async function CorrectivoTab({
  context,
  viewer,
  rawParams,
}: {
  context: LookerContext
  viewer: MantViewer
  rawParams: Record<string, string | string[] | undefined>
}) {
  const { filters, cross, options } = context
  const data = await loadCorrectiveTabData(viewer, context, () => loadCorrectivePage(viewer, filters, cross))

  // Los equipos de esta unidad que los filtros dejan dentro: la base del «de N controlados».
  const query = queryFilters(filters, cross)
  const controlled = options.equipment.filter((equipment) =>
    (query.worksiteIds.length === 0 || query.worksiteIds.includes(equipment.worksiteId))
    && (query.equipmentIds.length === 0 || query.equipmentIds.includes(equipment.id))).length

  return (
    <CorrectivePanel
      stats={data.stats}
      controlled={controlled}
      series={data.series}
      drivers={data.drivers}
      monthly={data.monthly}
      page={data.rows}
      unit={filters.unit}
      period={{ from: filters.from, to: filters.to }}
      hrefForPage={(target) => buildPaginationHref(PANEL, rawParams, target)}
      selected={{
        workId: cross.work?.id ?? null,
        driverKey: cross.conductor?.key ?? null,
        equipmentId: cross.equipment?.id ?? null,
        monthKey: cross.month?.key ?? null,
      }}
    />
  )
}
