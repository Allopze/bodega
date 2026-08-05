import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

const BREADCRUMBS = (
  <Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Administración" }]} />
)

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Panel de Administración"
        breadcrumb={BREADCRUMBS}
      />
      <SkeletonPage rows={8} />
    </>
  )
}
