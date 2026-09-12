import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"

// El breadcrumb no se declara acá a propósito: duplicarlo respecto a page.tsx
// abriría una segunda fuente de verdad que puede quedar desfasada si cambia.
export default function Loading() {
  return (
    <PageContainer>
      <PageHeader title="Tipos de activo TI" />
      <SkeletonPage rows={6} />
    </PageContainer>
  )
}
