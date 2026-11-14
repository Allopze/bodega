import type { Metadata } from "next"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { AddFuelDataButton } from "@/components/combustibles/add-fuel-data-button"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FuelHeaderActions } from "@/components/combustibles/fuel-header-actions"
import { DashboardSectionFallback } from "@/components/dashboard/dashboard-section"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { requirePermission } from "@/lib/auth/can"
import { resolveFuelPeriodForPage } from "@/lib/combustibles/period/server"
import { fuelAddDataOptions } from "@/lib/combustibles/section-nav"
import { ControlFilters } from "../_shared/control-filters"
import { loadControlContext } from "../consumo/_components/control-context"
import { ConsumoSection } from "./consumo-section"
import { EficienciaSection } from "./eficiencia-section"

export const metadata: Metadata = { title: "Indicadores de combustible" }

/** Ruta de la pantalla; `FUEL_PATHS` no la declara y esta pantalla no toca el módulo de rutas. */
const INDICADORES_PATH = "/combustibles/indicadores"

type SearchParams = Record<string, string | string[] | undefined>

const first = (value: string | string[] | undefined) => {
  const raw = Array.isArray(value) ? value[0] : value
  return raw?.trim() || undefined
}

/**
 * Indicadores de combustible: cómo fue el consumo del período y hacia dónde va. El Panel
 * sigue siendo la bandeja de trabajo («qué falta hoy»); esta pantalla contesta dos
 * preguntas con gráficos —Consumo y Eficiencia— sobre el período y la faena que la
 * persona elige una vez. Cada sección se resuelve por separado (Suspense): si una consulta
 * cae, sólo su bloque lo dice.
 */
export default async function IndicadoresCombustiblePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let session
  try { session = await requirePermission("combustibles:view", INDICADORES_PATH) } catch { redirect("/forbidden") }

  const sp = await searchParams
  const period = await resolveFuelPeriodForPage(session, sp)
  const worksiteId = first(sp.faena)
  const ctx = await loadControlContext(session, { years: false })
  const addDataOptions = fuelAddDataOptions(session)
  // Un cambio de período o de faena vuelve a mostrar el esqueleto de cada sección.
  const sectionKey = `${period.from}:${period.to}:${worksiteId ?? ""}`

  return (
    <PageContainer>
      <PageHeader
        title="Indicadores de combustible"
        description="Cómo fue el consumo del período y hacia dónde va"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Indicadores" }]} />}
        actions={
          <FuelHeaderActions period={period}>
            {addDataOptions.some((option) => option.allowed) ? <AddFuelDataButton options={addDataOptions} /> : null}
          </FuelHeaderActions>
        }
      />
      {/* La faena sólo se ofrece si hay más de una que elegir. */}
      {ctx.worksites.length > 1 || worksiteId ? <ControlFilters worksites={ctx.worksites} /> : null}
      <div className="flex flex-col gap-10">
        <Suspense key={`consumo:${sectionKey}`} fallback={<DashboardSectionFallback />}>
          <ConsumoSection session={session} period={period} worksiteId={worksiteId} />
        </Suspense>
        <Suspense key={`eficiencia:${sectionKey}`} fallback={<DashboardSectionFallback />}>
          <EficienciaSection session={session} period={period} worksiteId={worksiteId} />
        </Suspense>
      </div>
    </PageContainer>
  )
}
