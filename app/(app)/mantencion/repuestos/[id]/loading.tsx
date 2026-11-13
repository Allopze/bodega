import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer width="workbench">
      <PageHeader title="Ficha de repuesto" breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Catálogo de repuestos", href: "/mantencion/repuestos" }]} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]" aria-busy="true" aria-label="Cargando el repuesto">
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, index) => <SkeletonRow key={index} cols={4} />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    </PageContainer>
  )
}
