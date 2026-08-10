import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Equipo de servicio"
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Administración", href: "/admin" },
            { label: "Equipos de servicio", href: "/admin/equipos" },
          ]} />
        }
      />
      <SkeletonPage rows={5} />
    </>
  )
}
