import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"

/** La forma real de la pantalla: la frase de resumen, una tarjeta por fuente y la lista de archivos. */
export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Fuentes de datos"
        description="De dónde llegan los datos de combustible y cuándo llegaron por última vez"
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Fuentes de datos" }]} />}
      />
      <div aria-hidden className="grid gap-3">
        <Skeleton className="mb-1 h-5 w-2/3" />
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
            <div className="flex items-start gap-3">
              <Skeleton className="h-9 w-9" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-64" />
              </div>
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }, (_, cell) => <Skeleton key={cell} className="h-8" />)}
            </div>
          </div>
        ))}
        <Skeleton className="mt-6 h-6 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    </PageContainer>
  )
}
