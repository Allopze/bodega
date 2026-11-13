import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Callout } from "@/components/ui/callout"
import { DegradedDataBanner } from "@/components/ui/degraded-data-banner"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SectionNav } from "@/components/ui/section-nav"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { can, requirePermission } from "@/lib/auth/can"
import { getMediumCross } from "@/lib/combustibles/control/queries/reconciliation"
import { controlFiltersForRange, wholeMonthRange } from "@/lib/combustibles/control/queries/field-filters"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"
import { FUEL_PATHS, withFuelContext } from "@/lib/combustibles/routes"
import { FUEL_CARRY_PARAMS, cuadraturaNavItems } from "@/lib/combustibles/section-nav"
import { ControlFilters } from "../../_shared/control-filters"
import { loadCuadraturaContext } from "../_components/context"
import { firstParam, periodContext } from "../_components/params"
import { wholeMonthsNote } from "../_components/period-text"
import { SectionError } from "../_components/section"
import { createSourceTracker } from "../_components/track"
import { MediumSection, mediumAnswer } from "./medium-section"

export const metadata: Metadata = { title: "Proveedor y terreno" }

type SearchParams = Record<string, string | string[] | undefined>

export default async function CuadraturaProveedorPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:tae_view", FUEL_PATHS.cuadraturaProveedor) } catch { redirect("/forbidden") }
  const sp = await searchParams
  const period = await resolveFuelPeriodForPage(session, sp)
  const ctxParams = periodContext(period, firstParam(sp, "faena"))
  const filters = controlFiltersForRange(wholeMonthRange(period), { worksiteId: firstParam(sp, "faena"), mandanteId: firstParam(sp, "mandante") })
  const ctx = await loadCuadraturaContext(session)
  const canSources = can(session, "combustibles:import") || can(session, "combustibles:tae_import") || can(session, "combustibles:sync_integrations")

  const { track, degraded, total } = createSourceTracker("cuadratura-proveedor")
  const cross = await track(getMediumCross(session, filters), [], "cruce por medio")
  const note = wholeMonthsNote(period, "El cruce con el proveedor")
  const answer = cross.failed ? null : mediumAnswer(cross.data)

  return (
    <PageContainer>
      <PageHeader
        title="Proveedor y terreno"
        description="Lo que factura el proveedor contra lo que se registró en terreno"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Cuadratura", href: FUEL_PATHS.cuadratura }, { label: "Proveedor y terreno" }]} />}
        actions={<FuelHeaderActions period={period} />}
      />
      <SectionNav items={cuadraturaNavItems(session)} activeKey="proveedor" ariaLabel="Vistas de cuadratura" carryParams={FUEL_CARRY_PARAMS} />
      <DegradedDataBanner degraded={degraded} total={total()} />
      <ControlFilters worksites={ctx.worksites} mandantes={ctx.mandantes} />
      {note ? <Callout tone="info" className="mb-4">{note}</Callout> : null}
      {answer ? <p className="mb-5 max-w-3xl text-base text-[var(--color-text)]" data-testid="proveedor-answer">{answer}</p> : null}
      {cross.failed ? (
        <SectionError what="el cruce con el proveedor" />
      ) : (
        <MediumSection
          rows={cross.data}
          cargasHref={withFuelContext(`${FUEL_PATHS.cargas}?como=qr,app,historico`, ctxParams)}
          fuentesHref={canSources ? withFuelContext(FUEL_PATHS.fuentes, ctxParams) : null}
        />
      )}
    </PageContainer>
  )
}
