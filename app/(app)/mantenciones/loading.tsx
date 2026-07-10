import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Mantenciones"
        breadcrumb={<Breadcrumbs items={[{ label: "Control operacional", href: "/" }, { label: "Mantenciones" }]} />}
      />
      <SkeletonPage rows={8} />
    </>
  )
}
