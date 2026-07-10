import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Detalle documental SST"
        breadcrumb={<Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Documentación", href: "/prevencion/documentacion" }, { label: "Detalle" }]} />}
      />
      <SkeletonPage rows={6} />
    </>
  )
}
