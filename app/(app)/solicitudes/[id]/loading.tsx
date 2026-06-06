import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Solicitud"
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Solicitudes", href: "/solicitudes" },
            { label: "Detalle" },
          ]} />
        }
      />
      <SkeletonPage rows={6} />
    </>
  )
}
