import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Documentos DTE"
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Órdenes de compra", href: "/compras" },
            { label: "Documentos DTE" },
          ]} />
        }
      />
      <SkeletonPage rows={6} />
    </>
  )
}
