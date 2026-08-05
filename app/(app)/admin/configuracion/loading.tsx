import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"

const BREADCRUMBS = (
  <Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Administración", href: "/admin" }, { label: "Configuración" }]} />
)

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Configuración del Sistema"
        breadcrumb={BREADCRUMBS}
      />
      <SkeletonPage rows={6} />
    </>
  )
}
