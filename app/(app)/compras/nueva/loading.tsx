import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Nueva orden de compra"
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Órdenes de compra", href: "/compras" },
            { label: "Nueva" },
          ]} />
        }
      />
      <SkeletonPage rows={5} />
    </PageContainer>
  )
}
