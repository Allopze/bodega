import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Flota"
        breadcrumb={<Breadcrumbs items={[{ label: "Control operacional", href: "/" }, { label: "Flota" }]} />}
      />
      <SkeletonPage rows={8} />
    </>
  )
}
