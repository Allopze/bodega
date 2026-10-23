import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"

export default function ImportarLoading() {
  return (
    <PageContainer>
      <PageHeader
        title="Importar consumos"
        breadcrumb={<Breadcrumbs items={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Cargas", href: "/combustibles/bitacora" }, { label: "Importar consumos" }]} />}
      />
      <SkeletonPage rows={6} />
    </PageContainer>
  )
}
