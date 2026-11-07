import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Programa de trabajo preventivo"
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Prevención", href: "/prevencion" }, { label: "Programa de trabajo", href: "/prevencion/pdtp" }, { label: "Detalle" }]} />}
      />
      <SkeletonPage rows={8} />
    </>
  )
}
