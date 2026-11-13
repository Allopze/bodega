import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer>
      <PageHeader title="Dispositivos" breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Dispositivos" }]} />
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Cargando dispositivos">
        {Array.from({ length: 5 }).map((_, index) => <SkeletonRow key={index} cols={4} />)}
      </div>
    </PageContainer>
  )
}
