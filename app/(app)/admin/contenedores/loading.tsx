import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader title="Catálogo de contenedores" />
      <SkeletonPage rows={8} />
    </PageContainer>
  )
}
