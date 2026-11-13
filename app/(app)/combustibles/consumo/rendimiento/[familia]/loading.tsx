import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { SectionNavSkeleton } from "@/components/ui/section-nav-skeleton"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

/** Esqueleto de «Rendimiento»: pestañas, familia y filtros, la frase de respuesta y la tabla por equipo. */
export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Rendimiento"
        description="Cuánto rinde cada equipo contra su modelo y contra su propio historial"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Consumo", href: FUEL_PATHS.consumo }, { label: "Rendimiento" }]} />}
      />
      <SectionNavSkeleton tabs={3} />
      <div className="mb-5 flex flex-wrap gap-2" aria-hidden>
        <Skeleton className="h-9 w-24 rounded-full" />
        <Skeleton className="h-9 w-48 rounded-full" />
        <Skeleton className="h-9 w-28 rounded-full" />
      </div>
      <div className="mb-4 flex flex-wrap gap-2" aria-hidden>
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-32" />
      </div>
      <Skeleton className="mb-6 h-6 w-full max-w-xl" aria-label="Cargando rendimiento" />
      <div className="mb-10 space-y-2" role="status" aria-label="Cargando equipos">
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}
      </div>
      <div className="grid gap-6 lg:grid-cols-2" aria-hidden>
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </PageContainer>
  )
}
