import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Campañas y Capacitación"
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Prevención", href: "/prevencion" },
            { label: "Campañas y Capacitación" },
          ]} />
        }
      />
      <SkeletonPage rows={6} />
    </PageContainer>
  )
}
