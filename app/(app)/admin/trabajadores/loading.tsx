import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Trabajadores"
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Administración", href: "/admin" },
            { label: "Trabajadores" },
          ]} />
        }
      />
      <SkeletonPage rows={6} />
    </>
  )
}
