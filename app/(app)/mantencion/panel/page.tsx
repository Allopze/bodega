import type { Metadata } from "next"
import { redirect } from "next/navigation"
import type { Session } from "next-auth"
import { Callout } from "@/components/ui/callout"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { LookerExcelButton } from "@/components/mantencion/panel/looker/looker-export-button"
import { LookerFilterBar } from "@/components/mantencion/panel/looker/filter-bar"
import { PanelTabs } from "@/components/mantencion/panel/looker/panel-tabs"
import { can, requireAnyPermission } from "@/lib/auth/can"
import { DEFAULT_RANGE_LABEL } from "@/lib/indicators/period"
import { viewerFromSession } from "@/lib/services/mantencion/access"
import { filterChips, parseLookerTab, pickFilterParams } from "@/lib/services/mantencion/looker/filters"
import { loadLookerContext } from "@/lib/services/mantencion/looker/resolve"
import type { LookerTab } from "@/lib/services/mantencion/looker/types"
import { renderHoyTab } from "./hoy-tab"
import { PlanificacionTab } from "./planificacion-tab"
import { WorkTab } from "./work-tab"

export const metadata: Metadata = { title: "Panel de mantención" }
export const dynamic = "force-dynamic"

type SearchParams = Record<string, string | string[] | undefined>

const DESCRIPTION: Record<Exclude<LookerTab, "hoy">, string> = {
  planificacion: "Consolidado de mantención por kilómetros y por horas, con el delta y los faltantes de cada equipo.",
  camiones: "Trabajos correctivos y cumplimiento preventivo de los equipos controlados por kilómetros.",
  maquinas: "Trabajos correctivos y cumplimiento preventivo de las máquinas controladas por horas.",
}

/**
 * Panel de mantención con cuatro pestañas: «Hoy» (el Panel operativo de siempre) y las tres
 * réplicas del panel de Looker. La pestaña viaja en `pestana`; cada una es un enlace que lleva
 * sólo ese parámetro, así los filtros se reinician al cambiar de pestaña.
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
  const tab = parseLookerTab(params)

  if (tab === "hoy") return renderHoyTab(session, params)

  const viewer = viewerFromSession(session)
  const context = await loadLookerContext(viewer, params)
  const chips = filterChips(context.filters, context.options, context.cross)

  return (
    <PageContainer>
      <PageHeader
        title="Panel de mantención"
        description={DESCRIPTION[tab]}
        breadcrumb={<Breadcrumbs items={[
          { label: "Control operacional", href: "/control-operacional" },
          { label: "Mantención" },
          { label: "Panel" },
          { label: tab === "planificacion" ? "Planificación" : tab === "camiones" ? "Camiones" : "Máquinas" },
        ]} />}
        // Acción de página: el libro de la pestaña con los filtros de la URL, sólo con `mant:export` (el mismo criterio que
        // el Excel de «Hoy»). La acción de servidor vuelve a exigirlo y arma el libro con el alcance de quien exporta.
        actions={can(session, "mant:export") ? <LookerExcelButton tab={tab} params={pickFilterParams(params)} /> : undefined}
      />

      <PanelTabs active={tab} />

      {context.filters.invalidPeriod && (
        <Callout tone="warning" className="mb-4">
          El rango de fechas de la dirección no es válido: se muestra {DEFAULT_RANGE_LABEL}.
        </Callout>
      )}

      <div className="mant-looker rounded-[var(--radius-2xl)] bg-[var(--mant-bg)] p-3 md:p-5">
        <LookerFilterBar filters={context.filters} options={context.options} cross={context.cross} chips={chips} />
        {tab === "planificacion" ? (
          <PlanificacionTab context={context} viewer={viewer} />
        ) : (
          <WorkTab
            context={context}
            viewer={viewer}
            rawParams={params}
            unit={tab === "camiones" ? "km" : "h"}
          />
        )}
      </div>
    </PageContainer>
  )
}
