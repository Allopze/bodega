import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton, SkeletonPage } from "@/components/ui/skeleton"

/**
 * Esqueleto con la forma de la pantalla —la tira de vistas y la tabla—, no un
 * indicador en el centro: al llegar los datos nada se mueve de sitio.
 */
export default function Loading() {
  return (
    <PageContainer>
      <PageHeader title="Conductores" description="Licencias de conducir por faena" />
      <div role="status" aria-busy="true" className="flex flex-col gap-3">
        <span className="sr-only">Cargando conductores…</span>
        <div className="flex flex-wrap gap-2" aria-hidden>
          <Skeleton className="h-9 w-44 rounded-[var(--radius-md)]" />
          <Skeleton className="h-9 w-28 rounded-[var(--radius-md)]" />
          <Skeleton className="h-9 w-24 rounded-[var(--radius-md)]" />
        </div>
        <div aria-hidden className="overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <SkeletonPage rows={8} />
        </div>
      </div>
    </PageContainer>
  )
}
