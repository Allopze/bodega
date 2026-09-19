import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Control operacional"
        breadcrumb={<Breadcrumbs items={[{ label: "Control operacional" }]} />}
      />
      <SkeletonPage rows={8} />
    </>
  )
}
