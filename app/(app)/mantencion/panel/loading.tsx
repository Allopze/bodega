import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { DashboardSectionFallback } from "@/components/dashboard/dashboard-section"

/** Reserva el alto de los filtros, la franja «Hoy» y las dos secciones de gráficos para que no salten al resolver. */
export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Panel de mantención"
        breadcrumb={<Breadcrumbs items={[
          { label: "Control operacional", href: "/control-operacional" },
          { label: "Mantención" },
          { label: "Panel" },
        ]} />}
      />
      <Skeleton className="mb-4 h-9 w-72" />
      <Skeleton className="mb-6 h-14 w-full" />
      <div className="space-y-8">
        <DashboardSectionFallback />
        <DashboardSectionFallback />
      </div>
    </PageContainer>
  )
}
