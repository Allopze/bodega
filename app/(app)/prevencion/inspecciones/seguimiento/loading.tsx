import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"

// Sin este archivo la ruta heredaba el esqueleto de `/prevencion/inspecciones`, titulado «Inspecciones».
// El breadcrumb no se declara a propósito — el TopBar lo deriva de NAV_ITEMS + usePathname(), así que
// duplicarlo aquí sólo abriría otra fuente de verdad que puede quedar desfasada.
export default function Loading() {
  return (
    <PageContainer>
      <PageHeader title="Seguimiento de inspecciones" />
      <SkeletonPage rows={6} />
    </PageContainer>
  )
}
