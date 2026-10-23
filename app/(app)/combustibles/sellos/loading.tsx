import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Historial de sellos"
        breadcrumb={<Breadcrumbs items={[{ label: "Control operacional", href: "/control-operacional" }, { label: "TAE y sellos", href: "/combustibles/tae" }, { label: "Historial de sellos" }]} />}
      />
      <SkeletonPage rows={5} />
    </>
  )
}
