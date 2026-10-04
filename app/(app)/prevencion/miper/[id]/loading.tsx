import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Skeleton } from "@/components/ui/skeleton"

/** Esqueleto del espacio de trabajo: mismo ancho (`workbench`) y forma que la matriz por actividad. */
export default function Loading() {
  return (
    <PageContainer width="workbench">
      <PageHeader title="Matriz de riesgos" />
      <div aria-busy="true" className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </PageContainer>
  )
}
