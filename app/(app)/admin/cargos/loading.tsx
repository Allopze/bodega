import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"

export default function WorkerPositionsLoading() {
  return (
    <PageContainer>
      <PageHeader title="Cargos y capacidades" description="Cargando catálogo..." />
      <div className="space-y-3" aria-label="Cargando cargos y capacidades" aria-busy="true">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-72 w-full rounded-[var(--radius-xl)]" />
      </div>
    </PageContainer>
  )
}
