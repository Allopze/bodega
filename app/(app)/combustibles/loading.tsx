import { SkeletonPage } from "@/components/ui/skeleton"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Consumo y rendimiento"
        breadcrumb={<Breadcrumbs items={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Consumo y rendimiento" }]} />}
      />
      <SkeletonPage rows={8} />
    </PageContainer>
  )
}
