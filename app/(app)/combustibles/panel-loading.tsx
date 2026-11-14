import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { DashboardSectionFallback } from "@/components/dashboard/dashboard-section"

/**
 * Esqueleto del Panel mientras llegan sus datos. No es un `loading.tsx` a
 * propósito: un `loading` en `/combustibles` envolvería en Suspense a todo el
 * módulo, y entonces las páginas puente de las URL viejas redirigían dentro del
 * streaming (meta refresh + navegación del router, en carrera) en vez de
 * responder un 308. Cada sección tiene su propio `loading.tsx`.
 */
export function PanelLoading() {
  return (
    <PageContainer>
      <PageHeader title="Panel de combustible" breadcrumb={<FuelBreadcrumbs />} />
      <div aria-busy="true" aria-live="polite">
        <span className="sr-only">Cargando combustible…</span>
        <div aria-hidden className="space-y-5">
          <div className="flex items-center gap-4">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-1.5 flex-1 rounded-full" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="grid gap-px overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-border)] md:grid-cols-2 xl:grid-cols-5">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="space-y-3 bg-[var(--color-surface)] p-5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
          {/* Las dos secciones de gráficos (Consumo y Eficiencia) reservan su alto. */}
          <DashboardSectionFallback />
          <DashboardSectionFallback />
        </div>
      </div>
    </PageContainer>
  )
}
