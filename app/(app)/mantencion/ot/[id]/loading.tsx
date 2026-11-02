import { PageHeader } from "@/components/ui/page-header"
import { SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <>
      <PageHeader title="Orden de trabajo" breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Órdenes de trabajo", href: "/mantencion/ot" }]} />
      <SkeletonPage rows={8} />
    </>
  )
}
