import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Nueva solicitud"
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Solicitudes", href: "/solicitudes" },
            { label: "Nueva" },
          ]} />
        }
      />
      <SkeletonPage rows={5} />
    </>
  )
}
