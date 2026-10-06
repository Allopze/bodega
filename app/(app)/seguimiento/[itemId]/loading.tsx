import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Detalle de ítem"
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: "Inicio", href: "/dashboard" },
              { label: "Seguimiento de solicitudes", href: "/seguimiento" },
              { label: "Detalle" },
            ]}
          />
        }
      />
      <SkeletonPage rows={8} />
    </>
  )
}
