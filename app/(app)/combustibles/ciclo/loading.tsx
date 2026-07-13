import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Ciclo físico de combustible"
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Ciclo físico" }]} />}
      />
      <SkeletonPage rows={6} />
    </>
  )
}
