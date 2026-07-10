import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Documentación"
        breadcrumb={<Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Documentación" }]} />}
      />
      <SkeletonPage rows={8} />
    </>
  )
}
