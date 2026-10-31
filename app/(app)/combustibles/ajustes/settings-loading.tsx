import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

/**
 * Esqueleto de una sección de «Ajustes» mientras carga: la misma cabecera y la
 * forma de lo que viene (tabla o formulario). El submenú de la izquierda vive
 * en el layout y no parpadea.
 */
export function SettingsLoading({ title, shape = "table" }: { title: string; shape?: "table" | "form" | "cards" }) {
  return (
    <PageContainer>
      <PageHeader
        title={title}
        breadcrumb={<FuelBreadcrumbs items={[{ label: "Ajustes", href: FUEL_PATHS.ajustes }, { label: title }]} />}
      />
      <div role="status" aria-label="Cargando" className="space-y-3">
        <Skeleton className="h-4 w-2/3 max-w-xl" />
        {shape === "table" ? (
          <div className="space-y-2 rounded-2xl border border-[var(--color-border)] p-4">
            <Skeleton className="h-5 w-full" />
            {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-10 w-full" />)}
          </div>
        ) : shape === "form" ? (
          <div className="grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
            {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-16 w-full" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Skeleton className="h-56 w-full rounded-2xl" />
            <Skeleton className="h-56 w-full rounded-2xl" />
          </div>
        )}
      </div>
    </PageContainer>
  )
}
