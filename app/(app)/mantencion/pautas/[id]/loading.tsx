import { PageContainer } from "@/components/ui/page-container"
import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer width="workbench">
      <Skeleton className="mb-4 h-8 w-64" />
      <div className="flex flex-col gap-5" aria-busy="true" aria-label="Cargando la pauta">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    </PageContainer>
  )
}
