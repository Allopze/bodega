import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { SectionNavSkeleton } from "@/components/ui/section-nav-skeleton"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

/** Esqueleto de «Motor en vacío»: pestañas, filtros, la frase de respuesta, los dos gráficos mensuales y la tabla de equipos. */
export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Motor en vacío"
        description="Horas con el motor encendido sin trabajar, según la telemetría de los equipos"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Consumo", href: FUEL_PATHS.consumo }, { label: "Motor en vacío" }]} />}
      />
      <SectionNavSkeleton tabs={3} />
      <div className="mb-6 flex flex-wrap gap-2" aria-hidden>
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-56" />
      </div>
      <Skeleton className="mb-6 h-6 w-full max-w-xl" aria-label="Cargando motor en vacío" />
      <div className="mb-10 grid gap-8 xl:grid-cols-2" role="status" aria-label="Cargando gráficos">
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
      <div className="mb-10 space-y-2" aria-hidden>
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}
      </div>
    </PageContainer>
  )
}
