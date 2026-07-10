import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Evaluaciones del Trabajador"
        breadcrumb={<Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Evaluaciones SST", href: "/prevencion" }, { label: "Trabajador" }]} />}
      />
      <SkeletonPage rows={6} />
    </>
  )
}
