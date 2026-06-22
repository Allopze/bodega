import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Cargando reporte…"
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Soporte",   href: "/soporte" },
            { label: "Reporte" },
          ]} />
        }
      />
      <SkeletonPage rows={5} />
    </PageContainer>
  )
}
