import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Nuevo producto"
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Admin", href: "/admin/productos" },
            { label: "Productos", href: "/admin/productos" },
            { label: "Nuevo" },
          ]} />
        }
      />
      <SkeletonPage rows={5} />
    </>
  )
}
