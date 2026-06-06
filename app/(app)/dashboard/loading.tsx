import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        breadcrumb={<Breadcrumbs items={[{ label: "Dashboard" }]} />}
      />
      <SkeletonPage rows={6} />
    </>
  )
}
