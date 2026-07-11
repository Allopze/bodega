import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"

export default function ImportarLoading() {
  return (
    <PageContainer>
      <PageHeader
        title="Importar consumos de combustible"
        description="Carga reportes de tarjetas de combustible por patente y período, o el log operacional de cargas"
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Importar consumos" }]} />}
      />
      <SkeletonPage rows={6} />
    </PageContainer>
  )
}
