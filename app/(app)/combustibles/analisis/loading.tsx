import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Análisis de rendimiento por equipo"
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Análisis de rendimiento" }]} />}
      />
      <SkeletonPage rows={8} />
    </>
  )
}
