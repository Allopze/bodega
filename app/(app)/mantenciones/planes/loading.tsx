import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { SectionNavSkeleton } from "@/components/ui/section-nav-skeleton"
import { SkeletonPage } from "@/components/ui/skeleton"

// Sin este archivo la ruta heredaba el esqueleto de `/mantenciones` y el título
// «Mantenciones» parpadeaba antes de «Planes preventivos».
export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Planes preventivos"
        breadcrumb={<Breadcrumbs items={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantenciones", href: "/mantenciones" }, { label: "Planes preventivos" }]} />}
      />
      <SectionNavSkeleton tabs={3} />
      <SkeletonPage rows={6} />
    </PageContainer>
  )
}
