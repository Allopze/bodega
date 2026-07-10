import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Programa de Trabajo Preventivo"
        breadcrumb={<Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Prevención", href: "/prevencion" }, { label: "Programas PDTP", href: "/prevencion/pdtp" }, { label: "Detalle" }]} />}
      />
      <SkeletonPage rows={8} />
    </>
  )
}
