import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"

// M-15: skeleton de carga. El breadcrumb no se declara a propósito — el TopBar
// lo deriva de NAV_ITEMS + usePathname(), así que duplicarlo aquí sólo abriría
// otra fuente de verdad que puede quedar desfasada.
export default function Loading() {
  return (
    <PageContainer>
      <PageHeader title="Plan de acción PDTP" />
      <SkeletonPage rows={6} />
    </PageContainer>
  )
}
