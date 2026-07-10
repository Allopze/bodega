import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Detalle de resumen"
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Cuenta corriente", href: "/combustibles/cuenta-corriente" }, { label: "Detalle" }]} />}
      />
      <SkeletonPage rows={6} />
    </>
  )
}
