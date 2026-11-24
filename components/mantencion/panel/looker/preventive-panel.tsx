import { ChartFrame } from "@/components/charts/chart-frame"
import { DashboardPanel, PanelBlock } from "@/components/ui/dashboard-panel"
import { plural } from "@/lib/mantencion/format"
import { mechanicAction, monthAction, worksiteAction } from "@/lib/services/mantencion/looker/filters"
import type { ChecklistMatrix, PreventiveCompliance } from "@/lib/services/mantencion/looker/types"
import { CrossFilterBars } from "./cross-filter-bars"
import { ChecklistMatrixView } from "./checklist-matrix"
import { ComplianceByPlateTable } from "./preventive-tables"

/**
 * Columna Preventivo: cumplimiento por mes, por faena y mecánico, por patente y la matriz de
 * checklist. El % es el promedio de los % de cada pauta (no el cociente de los totales).
 * Cada bloque ignora la dimensión que él mismo emite, así el clic no lo vacía.
 */
export function PreventivePanel({
  monthly,
  byWorksite,
  byPlate,
  matrix,
  selectedMonth,
  selectedWorksiteId,
  selectedMechanicKey,
  selectedEquipmentId,
  selectedCheckId,
}: {
  monthly: PreventiveCompliance
  byWorksite: PreventiveCompliance
  byPlate: PreventiveCompliance
  matrix: ChecklistMatrix
  selectedMonth: string | null
  selectedWorksiteId: string | null
  selectedMechanicKey: string | null
  selectedEquipmentId: string | null
  selectedCheckId: string | null
}) {
  const monthItems = monthly.byMonth
    .filter((bucket) => bucket.percent != null)
    .map((bucket) => ({ key: bucket.key, label: bucket.label, value: bucket.percent! }))

  const worksiteItems = byWorksite.byWorksiteMechanic
    .filter((bucket): bucket is typeof bucket & { worksiteId: string; percent: number } => bucket.percent != null && !!bucket.worksiteId)
    .map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      value: bucket.percent,
      detail: plural(bucket.checks, "pauta", "pautas"),
    }))

  const selectedWorksiteMechanic = selectedWorksiteId && selectedMechanicKey
    ? `${selectedWorksiteId}|${selectedMechanicKey}`
    : null

  return (
    <div className="flex flex-col gap-4">
      <DashboardPanel cols="single">
        <PanelBlock padding="none">
          <ChartFrame
            title="% de cumplimiento por mes"
            description="Promedio de los % de cada pauta del mes. NA no entra en el cálculo."
          >
            <CrossFilterBars
              ariaLabel="% de cumplimiento por mes"
              items={monthItems}
              unit="%"
              mode="percent"
              max={100}
              selectedKey={selectedMonth}
              actionFor={(item) => monthAction(item.key, item.key === selectedMonth)}
              emptyMessage="Sin pautas con cumplimiento en el período."
            />
          </ChartFrame>
        </PanelBlock>

        <PanelBlock padding="none">
          <ChartFrame
            title="% de cumplimiento por faena y mecánico"
            description="Promedio de los % de cada pauta. Los nombres del histórico son texto libre."
          >
            <CrossFilterBars
              ariaLabel="% de cumplimiento por faena y mecánico"
              items={worksiteItems}
              unit="%"
              mode="percent"
              max={100}
              limit={12}
              selectedKey={selectedWorksiteMechanic}
              actionFor={(item) => {
                const bucket = byWorksite.byWorksiteMechanic.find((row) => row.key === item.key)
                if (!bucket?.worksiteId) return worksiteAction("", false)
                return bucket.mechanicKey
                  ? mechanicAction(bucket.worksiteId, bucket.mechanicLabel ?? bucket.mechanicKey, item.key === selectedWorksiteMechanic)
                  : worksiteAction(bucket.worksiteId, item.key === selectedWorksiteMechanic)
              }}
              emptyMessage="Sin pautas con faena y mecánico en el período."
            />
          </ChartFrame>
        </PanelBlock>
      </DashboardPanel>

      <DashboardPanel cols="single">
        <ComplianceByPlateTable
          rows={byPlate.byPlate}
          selectedId={selectedEquipmentId}
          title="Cumplimiento por patente"
          note="Promedio de los % de cada pauta de la patente; los niveles son los que aparecen en el período."
        />
      </DashboardPanel>

      <DashboardPanel cols="single">
        <ChecklistMatrixView matrix={matrix} selectedCheckId={selectedCheckId} />
      </DashboardPanel>
    </div>
  )
}
