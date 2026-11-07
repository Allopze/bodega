import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Campañas y capacitación"
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Prevención", href: "/prevencion" },
            { label: "Campañas y capacitación" },
          ]} />
        }
      />
      <SkeletonPage rows={6} />
    </PageContainer>
  )
}
