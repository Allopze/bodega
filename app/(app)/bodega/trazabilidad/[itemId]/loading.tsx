import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Detalle de ítem (Trazabilidad)"
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: "Inicio", href: "/dashboard" },
              { label: "Bodega", href: "/bodega" },
              { label: "Trazabilidad", href: "/bodega/trazabilidad" },
              { label: "Detalle" },
            ]}
          />
        }
      />
      <SkeletonPage rows={8} />
    </>
  )
}
