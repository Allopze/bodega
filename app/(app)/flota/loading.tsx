import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Vehículos"
        breadcrumb={<Breadcrumbs items={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Vehículos" }]} />}
      />
      <SkeletonPage rows={8} />
    </>
  )
}
