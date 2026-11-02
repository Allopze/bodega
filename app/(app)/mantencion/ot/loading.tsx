import { PageHeader } from "@/components/ui/page-header"
import { SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <>
      <PageHeader title="Órdenes de trabajo" breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Órdenes de trabajo" }]} />
      <SkeletonPage rows={8} />
    </>
  )
}
