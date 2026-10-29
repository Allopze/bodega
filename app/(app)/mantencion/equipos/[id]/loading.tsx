import { PageContainer } from "@/components/ui/page-container"
import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer width="workbench">
      <Skeleton className="mb-4 h-8 w-56" />
      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]" aria-busy="true" aria-label="Cargando la ficha">
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    </PageContainer>
  )
}
