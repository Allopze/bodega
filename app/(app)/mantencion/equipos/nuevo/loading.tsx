import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer width="form">
      <PageHeader title="Nuevo equipo" breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Equipos", href: "/mantencion/equipos" }, { label: "Nuevo equipo" }]} />
      <SkeletonPage rows={6} />
    </PageContainer>
  )
}
