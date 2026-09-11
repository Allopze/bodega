import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Catálogo de desviaciones"
        description="Las desviaciones que se pueden encontrar en terreno y la gravedad de cada una."
        breadcrumb={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Desviaciones" },
        ]}
      />
      <SkeletonPage rows={6} />
    </PageContainer>
  )
}
