import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Configuración del Sistema"
        breadcrumb={<Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Administración", href: "/admin" }, { label: "Configuración" }]} />}
      />
      <SkeletonPage rows={6} />
    </>
  )
}
