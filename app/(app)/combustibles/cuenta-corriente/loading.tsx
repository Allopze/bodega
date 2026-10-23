import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { SectionNavSkeleton } from "@/components/ui/section-nav-skeleton"
import { SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Cuenta corriente de combustible"
        breadcrumb={<Breadcrumbs items={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Facturas y pagos", href: "/combustibles/facturas" }, { label: "Cuenta corriente" }]} />}
      />
      <SectionNavSkeleton tabs={2} />
      <SkeletonPage rows={6} />
    </PageContainer>
  )
}
