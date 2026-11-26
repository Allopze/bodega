import { CorrectivePanel } from "@/components/mantencion/panel/looker/corrective-panel"
import { PreventivePanel } from "@/components/mantencion/panel/looker/preventive-panel"
import { WorkControlTab } from "@/components/mantencion/panel/looker/work-control-tab"
import { buildPaginationHref } from "@/lib/pagination"
import type { MantViewer } from "@/lib/services/mantencion/access"
import { loadCorrectivePage } from "@/lib/services/mantencion/looker/corrective"
import type { LookerContext } from "@/lib/services/mantencion/looker/types"
import { loadWorkControlData } from "@/lib/services/mantencion/looker/work-data"

const PANEL = "/mantencion/panel"

/**
 * «Por kilómetros» (km) y «Por horas» (h) comparten esta pestaña: el filtro de unidad del cargador es lo
 * que separa una de otra. Así el correctivo de un equipo por horas no se duplica con el de uno por kilómetros.
 *
 * El resumen de conductores se carga primero porque el conductor elegido filtra la tabla de OT
 * y el combinado; el gráfico de equipos ignora el equipo que él mismo emite.
 */
export async function WorkTab({
  context,
  viewer,
  rawParams,
  unit,
}: {
  context: LookerContext
  viewer: MantViewer
  rawParams: Record<string, string | string[] | undefined>
  unit: "km" | "h"
}) {
  const { filters, cross } = context
  const { drivers, monthly, byWorksite, byPlate, matrix, chart, rows: page } = await loadWorkControlData(
    viewer,
    context,
    (conductorWorkIds) => loadCorrectivePage(viewer, filters, cross, { conductorWorkIds }),
  )

  const selectedEquipmentId = cross.equipment?.id ?? null
  const selectedMonth = cross.month?.key ?? cross.check?.month ?? null
  const selectedWorksiteId = cross.worksite?.id ?? cross.equipment?.worksiteId ?? cross.work?.worksiteId ?? cross.check?.worksiteId ?? null
  const unitLabel = unit === "km" ? "equipos por kilómetros" : "equipos por horas"

  return (
    <WorkControlTab
      correctiveNote={`OT con ingreso a taller y correctivas del período, sólo ${unitLabel}.`}
      preventiveNote={`Pautas de formularios hasta el 30-11-2026 y registros de la plataforma desde el 01-12-2026, sólo ${unitLabel}.`}
      corrective={(
        <CorrectivePanel
          page={page}
          drivers={drivers}
          chart={chart}
          unit={unit}
          hrefForPage={(target) => buildPaginationHref(PANEL, rawParams, target)}
          selectedWorkId={cross.work?.id ?? null}
          selectedDriverKey={cross.conductor?.key ?? null}
          selectedEquipmentId={selectedEquipmentId}
        />
      )}
      preventive={(
        <PreventivePanel
          monthly={monthly}
          byWorksite={byWorksite}
          byPlate={byPlate}
          matrix={matrix}
          selectedMonth={selectedMonth}
          selectedWorksiteId={selectedWorksiteId}
          selectedMechanicKey={cross.mechanic?.key ?? null}
          selectedEquipmentId={selectedEquipmentId}
          selectedCheckId={cross.check?.id ?? null}
        />
      )}
    />
  )
}
