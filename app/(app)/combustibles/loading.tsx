import { SkeletonPage } from "@/components/ui/skeleton"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Combustibles"
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles" }]} />}
      />
      <SkeletonPage rows={8} />
    </PageContainer>
  )
}
