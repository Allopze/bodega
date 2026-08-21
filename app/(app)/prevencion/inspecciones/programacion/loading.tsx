import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"

// El breadcrumb no se declara a propósito — el TopBar lo deriva de NAV_ITEMS.
export default function Loading() {
  return (
    <PageContainer>
      <PageHeader title="Programación de inspecciones" />
      <SkeletonPage rows={6} />
    </PageContainer>
  )
}
