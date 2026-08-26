import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"

export default function Loading() {
  return (
    <PageContainer width="wide">
      <PageHeader title="Comparar revisiones" />
      <SkeletonPage rows={6} />
    </PageContainer>
  )
}
