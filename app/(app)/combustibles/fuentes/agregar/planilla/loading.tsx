import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

export default function Loading() {
  return (
    <PageContainer width="form">
      <PageHeader
        title="Agregar planilla de cargas"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Fuentes de datos", href: FUEL_PATHS.fuentes }, { label: "Planilla de cargas" }]} />}
      />
      <div aria-hidden className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-5">
        <Skeleton className="mb-4 h-5 w-48" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
        <Skeleton className="mt-4 h-40 w-full" />
        <div className="mt-4 flex justify-end"><Skeleton className="h-9 w-24" /></div>
      </div>
    </PageContainer>
  )
}
