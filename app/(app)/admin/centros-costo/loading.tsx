import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Centros de costo"
        breadcrumb={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Centros de costo" },
        ]}
      />
      <SkeletonPage rows={6} />
    </>
  )
}
