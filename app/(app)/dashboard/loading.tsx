import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Inicio"
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio" }]} />}
      />
      <SkeletonPage rows={6} />
    </>
  )
}
