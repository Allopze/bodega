import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Revisar importación EPP"
        breadcrumb={<Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Administración", href: "/admin" }, { label: "Productos", href: "/admin/productos" }, { label: "Importación EPP" }]} />}
      />
      <SkeletonPage rows={6} />
    </>
  )
}
