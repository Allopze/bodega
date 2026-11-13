import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SkeletonRow } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader title="Marcas y talleres" breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Marcas y talleres" }]} />
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Cargando catálogos">
        {Array.from({ length: 6 }).map((_, index) => <SkeletonRow key={index} cols={4} />)}
      </div>
    </PageContainer>
  )
}
