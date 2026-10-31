import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Esqueleto de carga de Combustible. Es el `loading` de la carpeta padre de todo
 * el módulo: lo ve cualquier pantalla que no tenga el suyo, así que no afirma
 * qué contenido viene (ni título de pantalla, ni pasos, ni cifras). Sólo dibuja
 * la forma común: la cabecera, una franja de avance, una fila de bloques y dos
 * bloques de contenido, a la altura que ocupará el Panel.
 */
export default function Loading() {
  return (
    <PageContainer>
      <PageHeader title="Combustible" breadcrumb={<FuelBreadcrumbs />} />
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
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            {Array.from({ length: 2 }, (_, index) => (
              <div key={index} className="space-y-4 rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-3/4" />
                {Array.from({ length: 3 }, (_, row) => (
                  <Skeleton key={row} className="h-12 w-full" />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageContainer>
  )
}
