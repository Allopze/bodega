import { PageHeader } from "@/components/ui/page-header"
import { SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <>
      <PageHeader title="Nota de pedido" breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Notas de pedido", href: "/mantencion/notas-pedido" }]} />
      <SkeletonPage rows={4} />
    </>
  )
}
