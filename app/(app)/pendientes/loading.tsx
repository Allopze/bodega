import { SkeletonPage } from "@/components/ui/skeleton"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"

/** Mantiene contexto y geometría de la tabla durante filtros o paginación. */
export default function LoadingPendingWork() {
  return (
    <>
      <PageHeader
        title="Mis pendientes"
        breadcrumb={<Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Mis pendientes" }]} />}
      />
      <SkeletonPage rows={8} />
    </>
  )
}
