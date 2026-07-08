import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Catálogos de productos"
        breadcrumb={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Catálogos de productos" },
        ]}
      />
      <SkeletonPage rows={6} />
    </>
  )
}
