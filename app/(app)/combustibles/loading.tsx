import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Combustibles"
        breadcrumb={<Breadcrumbs items={[{ label: "Adquisiciones", href: "/" }, { label: "Combustibles" }]} />}
      />
      <SkeletonPage rows={8} />
    </>
  )
}
