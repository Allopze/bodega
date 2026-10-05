import { SkeletonPage } from "@/components/ui/skeleton"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader title="Mantenciones" breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "TI", href: "/ti" }, { label: "Mantenciones" }]} />} />
      <SkeletonPage rows={8} />
    </PageContainer>
  )
}
