import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

const BREADCRUMBS = (
  <Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Administración", href: "/admin" }, { label: "Plantillas" }]} />
)

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Plantillas de correo"
        breadcrumb={BREADCRUMBS}
      />
      <SkeletonPage rows={6} />
    </>
  )
}
