import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

/** La forma del asistente: «Paso 1 de 7», la barra de avance, el título, dos selectores y el botón. */
export default function Loading() {
  return (
    <PageContainer width="form">
      <PageHeader
        title="Registrar carga"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Cargas", href: FUEL_PATHS.cargas }, { label: "Registrar" }]} />}
      />
      <div className="mx-auto flex w-full max-w-lg flex-col gap-5" aria-busy="true" aria-label="Cargando el registro de carga">
        <div className="space-y-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-2 w-full rounded-full" />
          <Skeleton className="h-8 w-40" />
        </div>
        <Skeleton className="h-5 w-3/4" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
        <Skeleton className="h-14 w-full" />
      </div>
    </PageContainer>
  )
}
