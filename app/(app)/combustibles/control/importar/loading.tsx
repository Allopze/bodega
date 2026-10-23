import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Skeleton, SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader
        title="Importar telemetría y suministro"
        breadcrumb={<Breadcrumbs items={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Cargas", href: "/combustibles/bitacora" }, { label: "Importar telemetría y suministro" }]} />}
      />
      <Skeleton className="mb-2 h-6 w-56" />
      <Skeleton className="mb-4 h-4 w-full max-w-xl" />
      <SkeletonPage rows={6} />
    </PageContainer>
  )
}
