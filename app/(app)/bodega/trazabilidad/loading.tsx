import { Skeleton, SkeletonPage } from "@/components/ui/skeleton"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    // El esqueleto va dentro del mismo `PageContainer` que la página: era el
    // único `loading.tsx` de la app sin él, así que cargaba a ancho completo y
    // el contenido saltaba al `max-w` real cuando llegaban los datos.
    <PageContainer width="wide">
      <PageHeader
        title="Trazabilidad y Seguimiento por Faena"
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: "Inicio", href: "/dashboard" },
              { label: "Bodega", href: "/bodega" },
              { label: "Trazabilidad" },
            ]}
          />
        }
      />

      {/* Selector de vista (SegmentedControl) */}
      <Skeleton className="mb-5 h-9 w-80 max-w-full rounded-[var(--radius-md)]" />

      <div className="space-y-3">
        {/* Los KPIs son 4 accionables desde la migración (A1/UI-01): el esqueleto
            dibuja 4 bloques a la altura del `KpiCard` real —etiqueta, cifra y
            detalle a dos líneas— para que la grilla no se reacomode al llegar
            los datos. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[7.5rem] rounded-[var(--radius-lg)]" />
          ))}
        </div>

        {/* Tira de métricas secundarias (SummaryBar). */}
        <Skeleton className="h-14 rounded-none" />

        {/* Barra de filtros y selector de faena. */}
        <Skeleton className="h-10 w-full rounded-[var(--radius-md)]" />

        {/* Tabla: mismo borde y radio que `TableRoot`, que es lo que aparece. */}
        <div className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
          <SkeletonPage rows={10} />
        </div>
      </div>
    </PageContainer>
  )
}
