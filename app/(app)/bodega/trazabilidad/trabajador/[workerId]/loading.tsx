import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Trazabilidad EPP del Trabajador"
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: "Inicio", href: "/dashboard" },
              { label: "Bodega", href: "/bodega" },
              { label: "Trazabilidad", href: "/bodega/trazabilidad" },
              { label: "Trabajador" },
            ]}
          />
        }
      />
      <SkeletonPage rows={4} />
    </PageContainer>
  )
}
