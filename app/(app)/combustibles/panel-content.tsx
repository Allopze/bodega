import type { Session } from "next-auth"
import Link from "next/link"
import { Suspense } from "react"
import { can } from "@/lib/auth/can"
import { Button } from "@/components/ui/button"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { AddFuelDataButton } from "@/components/combustibles/add-fuel-data-button"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { FieldPanel } from "@/components/combustibles/panel/panel-field"
import { PanelProgress, PanelStepsStrip } from "@/components/combustibles/panel/panel-steps"
import { DashboardSectionFallback } from "@/components/dashboard/dashboard-section"
import { loadPanelData, panelLinker } from "@/lib/combustibles/panel/data"
import { panelVariantForSession, type PanelVariant } from "@/lib/combustibles/panel/role-variant"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { fuelAddDataOptions } from "@/lib/combustibles/section-nav"
import { ConsumoSection } from "./_indicadores/consumo-section"
import { EficienciaSection } from "./_indicadores/eficiencia-section"
import { ControlFilters } from "./_shared/control-filters"
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

  const canRegister = can(session, "combustibles:register_load")
  const addDataOptions = fuelAddDataOptions(session)

  const header = (
    <PageHeader
      title="Panel de combustible"
      description={DESCRIPTIONS[variant]}
      breadcrumb={<FuelBreadcrumbs />}
      actions={
        <FuelHeaderActions period={period}>
          {addDataOptions.some((option) => option.allowed) ? <AddFuelDataButton options={addDataOptions} /> : null}
          {/* En terreno y contrato el bloque «Registrar una carga» ya es la acción principal. */}
          {canRegister && variant === "jefatura" ? (
            <Button asChild size="sm">
              <Link href={FUEL_PATHS.registrar}>Registrar carga</Link>
            </Button>
          ) : null}
        </FuelHeaderActions>
      }
    />
  )

  if (variant === "terreno" || variant === "contrato") {
    const data = await loadPanelData(session, period, variant)
    return (
      <PageContainer>
        {header}
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
  const worksiteId = first(sp.faena)

  return (
    <PageContainer>
      {header}

      {data && data.degraded.length > 0 ? (
        <div className="mb-4">
          <DegradedDataBanner degraded={data.degraded} total={data.total} />
        </div>
      ) : null}

      {data?.variant === "jefatura" ? (
        <div className="mb-8">
          <PanelProgress label={period.label} status={period.status} ready={data.steps.readyCount} total={data.steps.total} />
          <PanelStepsStrip steps={data.steps.steps} />
        </div>
      ) : null}

      {/* La faena acota los gráficos, no la tira de pasos (el cierre es de todo el alcance): por eso va aquí. */}
      {ctx.worksites.length > 1 || worksiteId ? <ControlFilters worksites={ctx.worksites} /> : null}
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
