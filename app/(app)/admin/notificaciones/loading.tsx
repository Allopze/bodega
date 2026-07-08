import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Notificaciones"
        breadcrumb={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Notificaciones" },
        ]}
      />
      <SkeletonPage rows={6} />
    </>
  )
}
