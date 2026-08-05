import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Orden de compra"
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Órdenes de compra", href: "/compras" },
            { label: "Detalle" },
          ]} />
        }
      />
      <SkeletonPage rows={6} />
    </>
  )
}
