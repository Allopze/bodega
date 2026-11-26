import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { SkeletonPage } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <PageContainer width="form">
      <PageHeader title="Importar respuestas de formularios" breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantención" }, { label: "Historial de mantenciones", href: "/mantencion/registros/historicos" }, { label: "Importar" }]} />
      <SkeletonPage rows={4} />
    </PageContainer>
  )
}
