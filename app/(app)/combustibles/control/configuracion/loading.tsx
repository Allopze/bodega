import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Configuración del control de combustible"
        breadcrumb={<Breadcrumbs items={[{ label: "Administración", href: "/admin" }, { label: "Configuración de combustible" }, { label: "Control de combustible" }]} />}
      />
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="border-t border-[var(--color-border)] py-8 first:border-t-0 first:pt-2">
          <Skeleton className="mb-2 h-6 w-48" />
          <Skeleton className="mb-4 h-4 w-full max-w-xl" />
          <Skeleton className="h-32 w-full" />
        </div>
      ))}
    </PageContainer>
  )
}
