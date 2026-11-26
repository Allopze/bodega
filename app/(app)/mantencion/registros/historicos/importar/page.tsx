import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { HistoricalImportPanel } from "@/components/mantencion/jefatura/registros/historical-import-panel"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { can, requirePermission } from "@/lib/auth/can"

export const metadata: Metadata = { title: "Importar respuestas de formularios" }
export const dynamic = "force-dynamic"

export default async function ImportHistoricalPage() {
  try {
    const session = await requirePermission("mant:equipment:manage")
    if (!can(session, "mant:records:view_all")) redirect("/forbidden")
  } catch {
    redirect("/forbidden")
  }
  return (
    <PageContainer width="form">
      <PageHeader
        title="Importar respuestas de formularios"
        description="Sube la exportación de Google Forms para incorporar las últimas respuestas hasta el corte de los formularios, conservando sus datos de origen."
        breadcrumb={[
          { label: "Control operacional", href: "/control-operacional" },
          { label: "Mantención" },
          { label: "Registros firmados", href: "/mantencion/registros" },
          { label: "Historial de mantenciones", href: "/mantencion/registros/historicos" },
          { label: "Importar" },
        ]}
      />
      <HistoricalImportPanel />
    </PageContainer>
  )
}
