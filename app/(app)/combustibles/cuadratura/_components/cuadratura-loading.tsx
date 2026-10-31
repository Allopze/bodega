import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SectionNavSkeleton } from "@/components/ui/section-nav-skeleton"
import { Skeleton } from "@/components/ui/skeleton"
import { FuelBreadcrumbs } from "@/components/combustibles/fuel-breadcrumbs"
import { FUEL_PATHS } from "@/lib/combustibles/routes"

/**
 * Esqueleto de una pantalla de Cuadratura: cabecera, barra de pestañas, la frase
 * que abre la vista, la fila de filtros y una o dos tablas. Cada `loading.tsx` lo
 * llama con su título y la forma de su cuerpo, para que no salte al resolverse.
 */
export function CuadraturaLoading({
  title,
  crumb,
  tabs = 5,
  filters = true,
  tables = 1,
  split = false,
}: {
  title: string
  crumb: string
  tabs?: number
  filters?: boolean
  /** Cuántas tablas muestra el cuerpo. */
  tables?: number
  /** La segunda tabla va a la derecha en pantallas anchas (mes a mes + qué mirar). */
  split?: boolean
}) {
  return (
    <PageContainer>
      <PageHeader title={title} breadcrumb={<FuelBreadcrumbs items={[{ label: "Cuadratura", href: FUEL_PATHS.cuadratura }, { label: crumb }]} />} />
      <SectionNavSkeleton tabs={tabs} />
      <div role="status" aria-label={`Cargando ${title.toLowerCase()}`} className="space-y-5">
        <Skeleton className="h-6 w-3/4 max-w-2xl" />
        {filters ? (
          <div className="flex flex-wrap gap-2.5">
            <Skeleton className="h-10 w-56" />
            <Skeleton className="h-10 w-56" />
          </div>
        ) : null}
        <div className={split ? "grid gap-5 lg:grid-cols-2" : "space-y-5"}>
          {Array.from({ length: tables }, (_, index) => (
            <div key={index} className="space-y-0 divide-y divide-[var(--color-border)] rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
              {Array.from({ length: index === 0 ? 5 : 4 }, (_, row) => (
                <div key={row} className="flex items-center gap-4 px-4 py-3">
                  <Skeleton className="h-4 w-1/5" />
                  <Skeleton className="h-4 w-1/6" />
                  <Skeleton className="h-4 w-1/6" />
                  <Skeleton className="h-4 w-1/5" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </PageContainer>
  )
}
