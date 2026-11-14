import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { DashboardSectionFallback } from "@/components/dashboard/dashboard-section"

/** Propio de Indicadores GPS: reserva el alto de las dos secciones para que no salten al resolver. */
export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Indicadores GPS"
        breadcrumb={<Breadcrumbs items={[
          { label: "Control operacional", href: "/control-operacional" },
          { label: "Flota", href: "/flota" },
          { label: "Indicadores" },
        ]} />}
      />
      <Skeleton className="mb-4 h-9 w-72" />
      <div className="space-y-8">
        <DashboardSectionFallback />
        <DashboardSectionFallback />
      </div>
    </PageContainer>
  )
}
