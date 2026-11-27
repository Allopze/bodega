import type { ReactNode } from "react"
import { ChartFrame } from "@/components/charts/chart-frame"
import { ChartSlot, DashboardPanel } from "@/components/ui/dashboard-panel"
import { CrossFilterBars } from "@/components/mantencion/panel/looker/cross-filter-bars"
import { PlanningSummary } from "@/components/mantencion/panel/looker/planning-summary"
import { PlanningTable } from "@/components/mantencion/panel/looker/planning-tables"
import { RemainingBars, remainingBarRows } from "@/components/mantencion/panel/looker/remaining-bars"
import { NEXT_THRESHOLD } from "@/lib/mantencion/status"
import { plural } from "@/lib/mantencion/format"
import type { MantViewer } from "@/lib/services/mantencion/access"
import { equipmentAction } from "@/lib/services/mantencion/looker/filter-hrefs"
import { PLANNING_STATE_LABEL } from "@/lib/services/mantencion/looker/filter-chips"
import { timingDetail, timingText, timingTone } from "@/lib/services/mantencion/looker/planning-rules"
import type { LookerContext, PlanningRow } from "@/lib/services/mantencion/looker/types"
import { loadPlanningTabData } from "@/lib/services/mantencion/looker/work-data"
import { todayInChile } from "@/lib/utils"

/** Lo que mide el gráfico: equipos con el punto en que tocaba y la lectura real de su última mantención. No depende de ningún período. */
const NO_TIMING = "No hay mantenciones con lectura programada y real."
const NO_REMAINING = "Ningún equipo tiene pauta y lectura para calcular lo que le falta."

/** Una sección del tablero: la pregunta que responde, una línea que la explica y UN panel con sus celdas. */
function PanelSection({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-titulo`}>
      <div className="mb-3">
        <h2 id={`${id}-titulo`} className="text-h2 text-[var(--color-text)]">{title}</h2>
        <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">{description}</p>
      </div>
      {children}
    </section>
  )
}

/** Equipos con las dos lecturas de su última mantención, del mayor desvío al menor. */
function timingItems(rows: PlanningRow[], unit: "km" | "h") {
  const withDelta = rows.filter((row) => row.delta != null)
  const items = withDelta
    .sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!))
    .map((row) => ({
      key: row.vehicleId,
      label: row.plate || row.code,
      value: row.delta!,
      tone: timingTone(row),
      detail: timingDetail(row, unit) ?? undefined,
    }))
  const text = new Map(withDelta.map((row) => [row.vehicleId, timingText(row, unit)]))
  return { items, text }
}

/**
 * Planificación de UNA unidad (km u horas, la de la pestaña): la tira de estados, qué le falta a cada equipo y el
 * detalle por equipo. Es el estado de hoy de cada equipo: sus consultas no filtran por período y la barra no lo
 * ofrece (PAN4-6); la faena, el equipo, la frecuencia, el estado y las fechas sí acotan.
 *
 * El gráfico de faltantes, el de «¿a tiempo?» y la tabla ignoran el equipo que ellos mismos emiten
 * (`ignore: ["equipment"]` en `loadPlanningTabData`): al hacer clic siguen completos y sólo se resalta el elegido.
 */
export async function PlanificacionTab({
  context,
  viewer,
}: {
  context: LookerContext
  viewer: MantViewer
  /** El orquestador la pasa por simetría con las otras pestañas; Planificación lee todo de `context`. */
  rawParams?: Record<string, string | string[] | undefined>
}) {
  const { filters, cross } = context
  const unit = filters.unit
  const data = await loadPlanningTabData(viewer, context)
  const selectedId = cross.equipment?.id ?? null
  const today = todayInChile()
  const unitLabel = unit === "km" ? "por kilómetros" : "por horas"
  const timing = timingItems(data.rows, unit)
  const excluded = data.rows.length - remainingBarRows(data.rows).length
  const remainingDescription = `Barra: parte del intervalo ya recorrida. La marca es el ${Math.round((1 - NEXT_THRESHOLD) * 100)} % (umbral de «próxima»).${excluded > 0 ? ` ${plural(excluded, "equipo sin pauta o lectura no aparece", "equipos sin pauta o lectura no aparecen")}.` : ""}`
  const emptyTitle = filters.planningState && data.counts.total > 0
    ? `Ningún equipo está en estado «${PLANNING_STATE_LABEL[filters.planningState]}»`
    : `Sin equipos ${unitLabel} con estos filtros`
  const emptyDescription = filters.planningState && data.counts.total > 0
    ? "Quita el estado de la tira de cifras para ver todos los equipos."
    : "Prueba con otra faena, otra frecuencia u otras fechas."

  return (
    <div className="flex flex-col gap-8">
      <p className="text-xs text-[var(--color-text-muted)]">
        Estado de hoy de cada equipo, sin período: cada fila muestra su última mantención, por antigua que sea. La próxima es el punto en que tocaba la última mantención + el intervalo base de la pauta, aunque se haya hecho tarde. Si el jefe de mantención ajustó el intervalo, la fila lo marca con un lápiz y el motivo.
      </p>

      <PlanningSummary counts={data.counts} unit={unit} />

      <PanelSection id="planificacion-faltan" title="¿Cuánto le falta a cada equipo?" description="Ordenado por lo que falta: arriba lo vencido. Clic en un equipo lo filtra.">
        <DashboardPanel cols="twelve">
          <ChartSlot className="lg:col-span-12 xl:col-span-6">
            <ChartFrame title="Faltantes para la próxima mantención" description={remainingDescription}>
              <RemainingBars rows={data.rows} unit={unit} selectedId={selectedId} emptyMessage={NO_REMAINING} />
            </ChartFrame>
          </ChartSlot>
          <ChartSlot className="lg:col-span-12 xl:col-span-6">
            <ChartFrame
              title="¿Se hizo a tiempo la última mantención?"
              description={`${unit === "km" ? "Cuántos kilómetros" : "Cuántas horas"} de diferencia hubo entre cuando tocaba y cuando se hizo. Naranja: tarde. Verde: a tiempo o antes.`}
            >
              <CrossFilterBars
                ariaLabel={`Diferencia entre cuando tocaba y cuando se hizo la última mantención, por equipo (${unit === "km" ? "kilómetros" : "horas"})`}
                items={timing.items}
                mode="delta"
                format={(item) => timing.text.get(item.key) ?? ""}
                selectedKey={selectedId}
                actionFor={(item) => equipmentAction(item.key, item.key === selectedId)}
                emptyMessage={NO_TIMING}
                className="max-h-[32rem] overflow-y-auto pr-1"
              />
            </ChartFrame>
          </ChartSlot>
        </DashboardPanel>
      </PanelSection>

      <PanelSection id="planificacion-detalle" title="Detalle por equipo" description="La última mantención de cada equipo, cuánto falta para la próxima y la fecha en que se estima. La patente abre su historial; el embudo filtra el panel.">
        <DashboardPanel>
          <PlanningTable
            title={`Detalle por equipo · ${unit === "km" ? "kilómetros" : "horas"}`}
            unit={unit}
            rows={data.rows}
            selectedId={selectedId}
            today={today}
            note="«Tocaba a los» es el punto de la pauta en que correspondía la última mantención; «Se hizo a los», la lectura real de ese día. La próxima se calcula desde el punto que tocaba, aunque se haya hecho tarde. La fecha estimada usa el uso diario de los últimos 30 días."
            emptyTitle={emptyTitle}
            emptyDescription={emptyDescription}
          />
        </DashboardPanel>
      </PanelSection>
    </div>
  )
}

