import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Aprobaciones PDTP"
        breadcrumb={<Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Prevención", href: "/prevencion" }, { label: "Programa SG-SST", href: "/prevencion/pdtp" }, { label: "Aprobaciones" }]} />}
      />
      <SkeletonPage rows={6} />
    </>
  )
}
