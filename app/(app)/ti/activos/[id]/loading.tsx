import { Skeleton } from "@/components/ui/skeleton"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader title="Ficha del equipo" breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "TI", href: "/ti" }, { label: "Inventario", href: "/ti/activos" }, { label: "Ficha del equipo" }]} />} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-48 rounded-2xl lg:col-span-2" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
      <Skeleton className="mt-4 h-64 rounded-2xl" />
    </PageContainer>
  )
}
