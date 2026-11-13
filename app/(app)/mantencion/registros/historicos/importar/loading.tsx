import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer width="form">
      <PageHeader title="Importar historial anterior" breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Registros firmados", href: "/mantencion/registros" }, { label: "Historial anterior", href: "/mantencion/registros/historicos" }, { label: "Importar" }]} />
      <SkeletonPage rows={4} />
    </PageContainer>
  )
}
