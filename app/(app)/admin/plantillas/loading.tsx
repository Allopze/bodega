import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Plantillas de correo"
        breadcrumb={<Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Administración", href: "/admin" }, { label: "Plantillas" }]} />}
      />
      <SkeletonPage rows={6} />
    </>
  )
}
