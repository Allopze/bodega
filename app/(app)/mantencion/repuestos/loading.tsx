import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SkeletonRow } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader title="Catálogo de repuestos" breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Catálogo de repuestos" }]} />
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Cargando el catálogo de repuestos">
        {Array.from({ length: 6 }).map((_, index) => <SkeletonRow key={index} cols={5} />)}
      </div>
    </PageContainer>
  )
}
