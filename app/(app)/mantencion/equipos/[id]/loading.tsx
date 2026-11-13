import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer width="workbench">
      <PageHeader title="Ficha de equipo" breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Equipos", href: "/mantencion/equipos" }]} />
      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]" aria-busy="true" aria-label="Cargando la ficha">
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    </PageContainer>
  )
}
