import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Bitácora general"
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Bitácora general" }]} />}
      />
      <SkeletonPage rows={8} />
    </>
  )
}
