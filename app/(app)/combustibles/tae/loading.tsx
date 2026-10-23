import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Cargas TAE"
        breadcrumb={<Breadcrumbs items={[{ label: "Control operacional", href: "/control-operacional" }, { label: "TAE y sellos" }]} />}
      />
      <SkeletonPage rows={7} />
    </>
  )
}
