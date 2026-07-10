import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Carga de combustible"
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Detalle" }]} />}
      />
      <SkeletonPage rows={6} />
    </>
  )
}
