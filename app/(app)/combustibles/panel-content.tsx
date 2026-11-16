import type { Session } from "next-auth"
import { Suspense } from "react"
import { can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { allWorksitesLabel } from "@/lib/auth/worksite-label"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { AddFuelDataButton } from "@/components/combustibles/add-fuel-data-button"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { FieldPanel } from "@/components/combustibles/panel/panel-field"
import { PanelProgress, PanelStepsStrip } from "@/components/combustibles/panel/panel-steps"
import { BoardExportButton } from "@/components/dashboard/board-export-button"
import { DashboardSectionFallback } from "@/components/dashboard/dashboard-section"
import { loadPanelData, panelLinker } from "@/lib/combustibles/panel/data"
import { panelVariantForSession, type PanelVariant } from "@/lib/combustibles/panel/role-variant"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { fuelAddDataOptions } from "@/lib/combustibles/section-nav"
import { ConsumoSection } from "./_indicadores/consumo-section"
import { EficienciaSection } from "./_indicadores/eficiencia-section"
import { loadControlContext } from "./consumo/_components/control-context"

type SearchParams = Record<string, string | string[] | undefined>

const DESCRIPTIONS: Record<PanelVariant, string> = {
  jefatura: "Qué falta para cerrar el período y cómo fue el consumo",
  contrato: "Tus cargas, tus archivos y lo que falta vincular",
  terreno: "Tus cargas y lo que te toca corregir",
  consulta: "Cómo fue el consumo de tus faenas en el período",
}

const first = (value: string | string[] | undefined) => {
  const raw = Array.isArray(value) ? value[0] : value
  return raw?.trim() || undefined
}

/**
 * El Panel con sus datos; `page.tsx` ya resolvió el permiso y las URL viejas.
 *
 * Desde el 2026-11-14 los Indicadores son el Panel (decisión del usuario): jefatura abre con la
 * franja de lo pendiente —el avance y los cinco pasos del cierre— y debajo van los gráficos de
 * Consumo y Eficiencia; consulta ve sólo los gráficos (no tiene trabajo pendiente). Terreno y
 * contrato conservan su estación de trabajo (registrar y corregir cargas), sin gráficos.
 * `/combustibles/indicadores` redirige acá.
 */
export async function PanelContent({ session, searchParams: sp }: { session: Session; searchParams: SearchParams }) {
  const period = await resolveFuelPeriodForPage(session, sp)
  const variant = panelVariantForSession(session)
  const link = panelLinker(period)

  const allLabel = allWorksitesLabel(resolveWorksiteScope(session))
  const canRegister = can(session, "combustibles:register_load")
  const addDataOptions = fuelAddDataOptions(session)

  // Jefatura y consulta ven el tablero: su cabecera sigue el esqueleto común (faena, período, acciones,
  // «Exportar Excel»). Terreno y contrato trabajan sus cargas y no tienen gráficos que acotar ni exportar.
  const header = (board?: { worksites: ReadonlyArray<{ id: string; name: string }>; worksiteId: string | null; worksiteName: string }) => (
    <PageHeader
      title="Panel de combustible"
      description={DESCRIPTIONS[variant]}
      breadcrumb={<FuelBreadcrumbs />}
      actions={
        <FuelHeaderActions
          period={period}
          worksites={board?.worksites}
          worksiteId={board?.worksiteId}
          allWorksitesLabel={allLabel}
          exportButton={board && can(session, "combustibles:export")
            ? <BoardExportButton title="Panel de combustible" range={{ from: period.from, to: period.to }} scope={{ periodo: period.label, faena: board.worksiteName }} />
            : null}
        >
          {/* Una sola entrada para dar de alta (A3): «Agregar datos» ya ofrece «Quiero registrar una carga a
              mano». El botón «Registrar carga» aparte repetía ese flujo y no dejaba caber el esqueleto común
              (faena, período, exportar) a 1280 px. En terreno y contrato el bloque «Registrar una carga» del
              cuerpo sigue siendo la acción principal. */}
          {addDataOptions.some((option) => option.allowed) ? <AddFuelDataButton options={addDataOptions} /> : null}
        </FuelHeaderActions>
      }
    />
  )

  if (variant === "terreno" || variant === "contrato") {
    const data = await loadPanelData(session, period, variant)
    return (
      <PageContainer>
        {header()}
        {data.degraded.length > 0 ? (
          <div className="mb-4">
            <DegradedDataBanner degraded={data.degraded} total={data.total} />
          </div>
        ) : null}
        {data.variant !== "jefatura" ? (
          <FieldPanel data={data} period={period} userId={session.user.id} canRegister={canRegister} link={link} />
        ) : null}
      </PageContainer>
    )
  }

  const [data, ctx] = await Promise.all([
    variant === "jefatura" ? loadPanelData(session, period, "jefatura") : Promise.resolve(null),
    loadControlContext(session, { years: false }),
  ])
  // Una faena fuera del alcance (o inventada en la URL) se ignora, como en los otros dos tableros.
  const requested = first(sp.faena)
  const worksite = requested ? ctx.worksites.find((item) => item.id === requested) : undefined
  const worksiteId = worksite?.id
  const worksiteName = worksite?.name ?? (ctx.worksites.length === 1 ? ctx.worksites[0]!.name : allLabel)

  return (
    <PageContainer>
      {header({ worksites: ctx.worksites, worksiteId: worksiteId ?? null, worksiteName })}

      {data && data.degraded.length > 0 ? (
        <div className="mb-4">
          <DegradedDataBanner degraded={data.degraded} total={data.total} />
        </div>
      ) : null}

      {data?.variant === "jefatura" ? (
        <div className="mb-8">
          <PanelProgress
            label={period.label}
            status={period.status}
            ready={data.steps.readyCount}
            total={data.steps.total}
            // La faena de la cabecera acota los gráficos; el cierre del mes es de todo el alcance.
            scopeNote={worksite ? `Los pasos del cierre no se filtran por faena: ${worksite.name} acota sólo los gráficos.` : undefined}
          />
          <PanelStepsStrip steps={data.steps.steps} />
        </div>
      ) : null}

      <PanelCharts session={session} period={period} worksiteId={worksiteId} />
    </PageContainer>
  )
}

/** Consumo y Eficiencia del período: cada sección se resuelve sola (Suspense) y, si su consulta cae, sólo su bloque lo dice. */
function PanelCharts({ session, period, worksiteId }: { session: Session; period: ResolvedFuelPeriod; worksiteId: string | undefined }) {
  // Un cambio de período o de faena vuelve a mostrar el esqueleto de cada sección.
  const sectionKey = `${period.from}:${period.to}:${worksiteId ?? ""}`
  return (
    <div className="flex flex-col gap-10">
      <Suspense key={`consumo:${sectionKey}`} fallback={<DashboardSectionFallback />}>
        <ConsumoSection session={session} period={period} worksiteId={worksiteId} />
      </Suspense>
      <Suspense key={`eficiencia:${sectionKey}`} fallback={<DashboardSectionFallback />}>
        <EficienciaSection session={session} period={period} worksiteId={worksiteId} />
      </Suspense>
    </div>
  )
}
