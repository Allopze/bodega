import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader title="Riesgo MIPER" />
      <SkeletonPage rows={5} />
    </PageContainer>
  )
}
