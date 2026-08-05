import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Detalle PPA"
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "PPA Digital", href: "/prevencion/ppa" }, { label: "Detalle" }]} />}
      />
      <SkeletonPage rows={8} />
    </>
  )
}
