import { EquipmentCheckSheet } from "@/components/mantencion/panel/looker/equipment-check-sheet"
import { PreventivePanel } from "@/components/mantencion/panel/looker/preventive-panel"
import { historyHref, parseHistoryParams } from "@/lib/mantencion/history-view"
import type { MantViewer } from "@/lib/services/mantencion/access"
import { loadEquipmentCheckDetail } from "@/lib/services/mantencion/looker/equipment-check-detail"
import { sheetHref } from "@/lib/services/mantencion/looker/filter-hrefs"
import type { LookerContext } from "@/lib/services/mantencion/looker/types"
import { loadPreventiveTabData } from "@/lib/services/mantencion/looker/work-data"
import { todayInChile } from "@/lib/utils"

const PANEL = "/mantencion/panel"

function currentParams(raw: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item)
  }
  return params
}

/**
 * Preventivo: la tira de cifras, el cumplimiento por mes y por faena, la tabla por equipo y la matriz de checklist,
 * más la ficha del equipo cuando la dirección trae `ficha` (y `pauta`). El detalle de la ficha se carga SÓLO con
 * `ficha` presente y con el alcance y la visibilidad de quien mira (`loadEquipmentCheckDetail` los vuelve a aplicar).
 */
export async function PreventivoTab({
  context,
  viewer,
  rawParams,
}: {
  context: LookerContext
  viewer: MantViewer
  rawParams: Record<string, string | string[] | undefined>
}) {
  const { filters, cross } = context
  const today = todayInChile()
  const vehicleId = filters.sheetVehicleId
  const [data, detail] = await Promise.all([
    loadPreventiveTabData(viewer, context),
    vehicleId ? loadEquipmentCheckDetail(viewer, vehicleId, { from: filters.from, to: filters.to }, filters.sheetCheckId) : Promise.resolve(null),
  ])

  const current = currentParams(rawParams)
  const history = vehicleId
    ? historyHref(parseHistoryParams({}, today), { vehicleId, type: "preventiva", period: "personalizado", from: filters.from, to: filters.to })
    : null

  return (
    <>
      <PreventivePanel
        data={data}
        selected={{
          month: cross.month?.key ?? cross.check?.month ?? null,
          worksiteId: cross.worksite?.id ?? cross.equipment?.worksiteId ?? cross.check?.worksiteId ?? null,
          mechanicKey: cross.mechanic?.key ?? null,
          equipmentId: cross.equipment?.id ?? null,
          checkId: cross.check?.id ?? null,
          openVehicleId: vehicleId,
        }}
        currentMonth={today.slice(0, 7)}
        hrefForCheck={(check) => (check.vehicleId ? sheetHref(PANEL, current, check.vehicleId, check.id) : null)}
      />
      {vehicleId && <EquipmentCheckSheet vehicleId={vehicleId} detail={detail} historyHref={history} />}
    </>
  )
}
