import { PageContainer } from "@/components/ui/page-container"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { SkeletonPage } from "@/components/ui/skeleton"

// El detalle de una OT no lleva la barra de pestañas de Mantenciones; sin este
// archivo heredaba el esqueleto de la lista, que ahora sí la dibuja.
export default function Loading() {
  return (
    <PageContainer width="workbench">
      <PageHeader
        title="Orden de trabajo"
        breadcrumb={<Breadcrumbs items={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Mantenciones", href: "/mantenciones" }, { label: "Detalle" }]} />}
      />
      <SkeletonPage rows={6} />
    </PageContainer>
  )
}
