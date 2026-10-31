import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { SectionNavSkeleton } from "@/components/ui/section-nav-skeleton"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

/** Esqueleto de «Consumo»: filtros, la frase de respuesta, el gráfico mensual con «de dónde vino lo cargado» y las series de medidor. */
export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Consumo y rendimiento"
        description="Litros por faena, equipo y origen del combustible"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Consumo", href: FUEL_PATHS.consumo }, { label: "Litros" }]} />}
      />
      <SectionNavSkeleton tabs={3} />
      <div className="mb-6 flex flex-wrap gap-2" aria-hidden>
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-56" />
      </div>
      <Skeleton className="mb-6 h-6 w-full max-w-xl" aria-label="Cargando consumo" />
      <div className="mb-10 grid gap-8 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]" role="status" aria-label="Cargando gráficos">
        <Skeleton className="h-80 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
      <div className="mb-10 grid gap-8 xl:grid-cols-2" aria-hidden>
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
      <div className="space-y-3" aria-hidden>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </PageContainer>
  )
}
