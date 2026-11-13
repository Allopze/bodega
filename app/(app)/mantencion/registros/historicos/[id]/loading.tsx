import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer width="workbench">
      <PageHeader title="Trabajo del historial anterior" breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Registros firmados", href: "/mantencion/registros" }, { label: "Historial anterior", href: "/mantencion/registros/historicos" }]} />
      <SkeletonPage rows={6} />
    </PageContainer>
  )
}
