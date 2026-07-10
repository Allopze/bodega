import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Nuevo programa preventivo"
        breadcrumb={<Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Programas PDTP", href: "/prevencion/pdtp" }, { label: "Nuevo" }]} />}
      />
      <SkeletonPage rows={6} />
    </>
  )
}
