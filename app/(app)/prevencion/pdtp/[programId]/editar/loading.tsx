import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Editar programa PDTP"
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Programas PDTP", href: "/prevencion/pdtp" }, { label: "Editar" }]} />}
      />
      <SkeletonPage rows={8} />
    </>
  )
}
