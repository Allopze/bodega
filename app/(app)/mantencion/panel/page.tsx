import type { Metadata } from "next"
import { redirect } from "next/navigation"
import type { Session } from "next-auth"
import { Callout } from "@/components/ui/callout"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { LookerExcelButton } from "@/components/mantencion/panel/looker/looker-export-button"
import { LookerFilterBar } from "@/components/mantencion/panel/looker/filter-bar"
import { PanelTabs, PANEL_TABS } from "@/components/mantencion/panel/looker/panel-tabs"
import { PlanningDateFilter } from "@/components/mantencion/panel/looker/planning-date-filter"
import { can, requireAnyPermission } from "@/lib/auth/can"
import { DEFAULT_RANGE_LABEL } from "@/lib/indicators/period"
import { viewerFromSession } from "@/lib/services/mantencion/access"
import { filterChips } from "@/lib/services/mantencion/looker/filter-chips"
import { legacyTabRedirect, parseLookerTab, pickFilterParams } from "@/lib/services/mantencion/looker/filters"
import { loadLookerContext } from "@/lib/services/mantencion/looker/resolve"
import { todayInChile } from "@/lib/utils"
import { CorrectivoTab } from "./correctivo-tab"
import { renderHoyTab } from "./hoy-tab"
import { PlanificacionTab } from "./planificacion-tab"
import { PreventivoTab } from "./preventivo-tab"

export const metadata: Metadata = { title: "Panel de mantención" }
export const dynamic = "force-dynamic"

type SearchParams = Record<string, string | string[] | undefined>

const PANEL = "/mantencion/panel"

/**
 * Panel de mantención con cuatro pestañas: «Hoy» (el Panel operativo de siempre), Planificación, Correctivo y
 * Preventivo. La pestaña viaja en `pestana` y la unidad de control en `unidad` (km por defecto, omitido en la URL);
 * cada pestaña es un enlace que conserva la unidad, el período y la faena y suelta los filtros propios.
 *
 * Compatibilidad: un enlace guardado con `pestana=camiones|maquinas` (las pestañas «Por kilómetros» y «Por horas»
 * de antes) se redirige a `pestana=correctivo` con su unidad y el resto de los parámetros intactos, así la URL que
 * queda es la canónica (las pestañas, los chips y el botón de exportar ven el valor nuevo).
 *
 * Gate: `mant:records:view_*`. Las consultas de OT y de registros vuelven a aplicar su propia
 * visibilidad y el alcance por faena: ocultar una pestaña no es autorización.
 */
export default async function MantencionPanelPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session: Session
  try {
    session = await requireAnyPermission(["mant:records:view_worksite", "mant:records:view_all"])
  } catch {
    redirect("/forbidden")
  }
  const params = await searchParams
  const legacy = legacyTabRedirect(PANEL, params)
  if (legacy) redirect(legacy)
  const tab = parseLookerTab(params)

  if (tab === "hoy") return renderHoyTab(session, params)

  const viewer = viewerFromSession(session)
  const today = todayInChile()
  const context = await loadLookerContext(viewer, params, today)
  const chips = filterChips(context.filters, context.options, context.cross)
  const tabLabel = PANEL_TABS.find((item) => item.value === tab)?.label ?? ""

  return (
    <PageContainer>
      <PageHeader
        title="Panel de mantención"
        breadcrumb={<Breadcrumbs items={[
          { label: "Control operacional", href: "/control-operacional" },
          { label: "Mantención" },
          { label: "Panel" },
          { label: tabLabel },
        ]} />}
        // Acción de página: el libro de la pestaña con los filtros de la URL, sólo con `mant:export` (el mismo criterio que
        // el Excel de «Hoy»). La acción de servidor vuelve a exigirlo y arma el libro con el alcance de quien exporta.
        actions={can(session, "mant:export") ? <LookerExcelButton tab={tab} params={pickFilterParams(params)} /> : undefined}
      />

      <PanelTabs active={tab} params={params} />

      {/* Planificación no usa el período (es el estado de hoy, PAN4-6): un rango malo en la dirección no le cambia nada. */}
      {context.filters.invalidPeriod && tab !== "planificacion" && (
        <Callout tone="warning" className="mb-4">
          El rango de fechas de la dirección no es válido: se muestra {DEFAULT_RANGE_LABEL}.
        </Callout>
      )}
      {context.filters.invalidDateRange && tab === "planificacion" && (
        <Callout tone="warning" className="mb-4">
          Las fechas del filtro de la dirección no son válidas: se muestran todos los equipos, sin filtrar por fecha.
        </Callout>
      )}

      <div className="mant-looker rounded-[var(--radius-2xl)] bg-[var(--mant-bg)] p-3 md:p-5">
        <LookerFilterBar filters={context.filters} options={context.options} cross={context.cross} chips={chips}>
          {tab === "planificacion" ? <PlanningDateFilter filters={context.filters} today={today} /> : null}
        </LookerFilterBar>
        {tab === "planificacion" && <PlanificacionTab context={context} viewer={viewer} rawParams={params} />}
        {tab === "correctivo" && <CorrectivoTab context={context} viewer={viewer} rawParams={params} />}
        {tab === "preventivo" && <PreventivoTab context={context} viewer={viewer} rawParams={params} />}
      </div>
    </PageContainer>
  )
}
