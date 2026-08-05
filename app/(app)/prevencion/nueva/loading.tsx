import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Nueva Evaluación SST"
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Evaluaciones SST", href: "/prevencion" }, { label: "Nueva" }]} />}
      />
      <SkeletonPage rows={8} />
    </>
  )
}
