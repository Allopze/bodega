import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Evaluación SST"
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio",        href: "/dashboard"  },
            { label: "Evaluaciones SST", href: "/prevencion" },
            { label: "Cargando…"                             },
          ]} />
        }
      />
      <div className="space-y-6">
        <div className="border border-(--color-border) bg-(--color-surface) p-5 space-y-4">
          <div className="flex justify-between gap-4">
            <div className="space-y-2 flex-1">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-8 w-16" />
            </div>
          </div>
          <div className="pt-1 border-t border-(--color-border)">
            <Skeleton className="h-8 w-32" />
          </div>
        </div>
        <div className="space-y-4">
          <Skeleton className="h-9 w-full" />
          <div className="border border-(--color-border) bg-(--color-surface) p-5 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </div>
      </div>
    </PageContainer>
  )
}
