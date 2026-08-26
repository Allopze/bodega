import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"

export default function Loading() {
  return (
    <PageContainer width="full">
      <PageHeader title="Vista matriz" />
      <SkeletonPage rows={8} />
    </PageContainer>
  )
}
