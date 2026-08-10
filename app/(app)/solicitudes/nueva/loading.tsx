import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Nueva solicitud"
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Solicitudes", href: "/solicitudes" },
            { label: "Nueva" },
          ]} />
        }
      />
      <SkeletonPage rows={5} />
    </PageContainer>
  )
}
