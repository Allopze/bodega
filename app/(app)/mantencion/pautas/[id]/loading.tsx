import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer width="workbench">
      <PageHeader title="Pauta" breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Pautas", href: "/mantencion/pautas" }]} />
      <div className="flex flex-col gap-5" aria-busy="true" aria-label="Cargando la pauta">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    </PageContainer>
  )
}
