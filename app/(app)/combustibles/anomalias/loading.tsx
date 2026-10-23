import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Anomalías de combustible"
        breadcrumb={<Breadcrumbs items={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Revisión", href: "/combustibles/revision" }, { label: "Anomalías" }]} />}
      />
      <SkeletonPage rows={4} />
    </>
  )
}
