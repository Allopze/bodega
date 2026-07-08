import { SkeletonPage } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/ui/page-header"

export default function Loading() {
  return (
    <>
      <PageHeader
        title="Seguridad y bloqueos"
        breadcrumb={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Seguridad y bloqueos" },
        ]}
      />
      <SkeletonPage rows={6} />
    </>
  )
}
