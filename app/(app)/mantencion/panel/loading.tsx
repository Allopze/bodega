import { PageHeader } from "@/components/ui/page-header"
import { SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <>
      <PageHeader title="Panel de mantención" breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Panel" }]} />
      <SkeletonPage rows={6} />
    </>
  )
}
