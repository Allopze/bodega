import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Configuración de Correo"
        breadcrumb={<Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Administración", href: "/admin" }, { label: "Correo" }]} />}
      />
      <SkeletonPage rows={6} />
    </>
  )
}
