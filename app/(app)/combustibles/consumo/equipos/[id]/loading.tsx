import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

/** Esqueleto de la ficha de equipo: la tira de cifras, el gráfico carga a carga con lo pendiente, y las últimas cargas. */
export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Equipo"
        description="Cargas, rendimiento, motor en vacío, sellos y casos del equipo"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Consumo", href: FUEL_PATHS.consumo }, { label: "Equipo" }]} />}
      />
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4" role="status" aria-label="Cargando equipo">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-24 w-full" />)}
      </div>
      <div className="mb-8 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" aria-hidden>
        <Skeleton className="h-80 w-full" />
        <div className="grid gap-6">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-36 w-full" />
        </div>
      </div>
      <div className="space-y-2" aria-hidden>
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}
      </div>
    </PageContainer>
  )
}
