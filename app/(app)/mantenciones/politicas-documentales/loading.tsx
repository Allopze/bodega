import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { SectionNavSkeleton } from "@/components/ui/section-nav-skeleton"
import { SkeletonPage } from "@/components/ui/skeleton"

// Sin este archivo la ruta heredaba el esqueleto de `/mantenciones` y el título
// «Mantenciones» parpadeaba antes de «Políticas documentales». El ancho es el de
// la pantalla real (`workbench`).
export default function Loading() {
  return (
    <PageContainer width="workbench">
      <PageHeader
        title="Políticas documentales"
        breadcrumb={<Breadcrumbs items={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantenciones", href: "/mantenciones" }, { label: "Políticas documentales" }]} />}
      />
      <SectionNavSkeleton tabs={3} />
      <SkeletonPage rows={6} />
    </PageContainer>
  )
}
