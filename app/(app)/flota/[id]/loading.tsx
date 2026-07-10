import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Detalle de vehículo"
        breadcrumb={<Breadcrumbs items={[{ label: "Vehículos", href: "/flota" }, { label: "Detalle" }]} />}
      />
      <SkeletonPage rows={6} />
    </>
  )
}
