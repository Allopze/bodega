import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Cuenta corriente de combustible"
        breadcrumb={<Breadcrumbs items={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Facturas y pagos", href: "/combustibles/facturas" }, { label: "Cuenta corriente" }]} />}
      />
      <SkeletonPage rows={6} />
    </>
  )
}
