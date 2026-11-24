import { ChartFrame } from "@/components/charts/chart-frame"
import { DashboardPanel, PanelBlock } from "@/components/ui/dashboard-panel"
import { CrossFilterBars } from "@/components/mantencion/panel/looker/cross-filter-bars"
import { PlanningTable } from "@/components/mantencion/panel/looker/planning-tables"
import { equipmentAction } from "@/lib/services/mantencion/looker/filters"
import { loadPlanningData, unitMismatchMessage } from "@/lib/services/mantencion/looker/planning"
import type { LookerContext, PlanningRow } from "@/lib/services/mantencion/looker/types"
import type { MantViewer } from "@/lib/services/mantencion/access"
import { formatQty } from "@/lib/utils"

function deltaItems(rows: PlanningRow[]) {
  return rows
    .filter((row) => row.delta != null)
    .sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!))
    .slice(0, 12)
    .map((row) => ({
      key: row.vehicleId,
      label: row.plate || row.code,
      value: row.delta!,
      detail: `${row.code} · A ${formatQty(row.programmed ?? 0)} / B ${formatQty(row.real ?? 0)}`,
    }))
}

/**
 * Planificación general: el consolidado por kilómetros y por horas, con sus gráficos de delta.
 *
 * La tabla de km ignora el equipo que ella misma emite (`ignore: ["equipment"]`): al hacer clic
 * en una fila, la tabla sigue completa y se resaltan sus filas; la tabla y el gráfico de horas
 * sí aplican el equipo y, si es de km, muestran el mensaje contextual.
 */
export async function PlanificacionTab({ context, viewer }: { context: LookerContext; viewer: MantViewer }) {
  const { filters, cross } = context
  const [kmData, hoursData] = await Promise.all([
    loadPlanningData(viewer, filters, cross, ["equipment"]),
    loadPlanningData(viewer, filters, cross),
  ])
  const selectedId = cross.equipment?.id ?? null
  const hoursMismatch = unitMismatchMessage(cross.equipment, "h")
  const kmMismatch = unitMismatchMessage(cross.equipment, "km")
  const kmItems = deltaItems(kmData.km)
  const hoursItems = deltaItems(hoursData.hours)

  return (
    <div className="flex flex-col gap-5">
      <p className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
        Próxima = punto de la última mantención + intervalo base de la pauta. Si el jefe de mantención ajustó el intervalo, la fila lo marca con un lápiz y el motivo. Ordenado por faltantes: lo vencido queda arriba.
      </p>

      <DashboardPanel cols="single">
        <PlanningTable
          title="Consolidado mantención por kilómetros"
          unit="km"
          rows={kmData.km}
          selectedId={selectedId}
          note="A = km programados de la última mantención; B = km reales. Delta = A − B; faltantes = próxima − actual."
          emptyTitle={kmMismatch ?? "Sin equipos por kilómetros con estos filtros"}
          emptyDescription={kmMismatch ?? "Prueba con otra faena, otro código u otra frecuencia."}
        />
      </DashboardPanel>

      <DashboardPanel cols="single">
        <PanelBlock padding="none">
          <ChartFrame
            title="Delta kilometraje"
            description="A − B por equipo. Verde: se hizo antes o a tiempo; naranja: atraso. Barras más grandes primero."
          >
            <CrossFilterBars
              ariaLabel="Delta de kilometraje por equipo"
              items={kmItems}
              unit=" km"
              mode="delta"
              selectedKey={selectedId}
              actionFor={(item) => equipmentAction(item.key, item.key === selectedId)}
              emptyMessage="Sin mantenimientos con lectura programada y real en el período."
            />
          </ChartFrame>
        </PanelBlock>
      </DashboardPanel>

      <DashboardPanel cols="single">
        <PlanningTable
          title="Consolidado mantención por horas"
          unit="h"
          rows={hoursData.hours}
          selectedId={selectedId}
          note="A = horas programadas de la última mantención; B = horas reales. Delta = A − B; faltantes = próxima − actual."
          emptyTitle={hoursMismatch ?? "Sin equipos por horas con estos filtros"}
          emptyDescription={hoursMismatch ?? "Prueba con otra faena, otro código u otra frecuencia."}
        />
      </DashboardPanel>

      <DashboardPanel cols="single">
        <PanelBlock padding="none">
          <ChartFrame
            title="Delta horas"
            description="A − B por equipo. Verde: se hizo antes o a tiempo; naranja: atraso. Barras más grandes primero."
          >
            <CrossFilterBars
              ariaLabel="Delta de horas por equipo"
              items={hoursItems}
              unit=" h"
              mode="delta"
              selectedKey={selectedId}
              actionFor={(item) => equipmentAction(item.key, item.key === selectedId)}
              emptyMessage={hoursMismatch ?? "Sin mantenimientos con lectura programada y real en el período."}
            />
          </ChartFrame>
        </PanelBlock>
      </DashboardPanel>
    </div>
  )
}
