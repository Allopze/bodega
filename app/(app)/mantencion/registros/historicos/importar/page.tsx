import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { HistoricalImportPanel } from "@/components/mantencion/jefatura/registros/historical-import-panel"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { can, requirePermission } from "@/lib/auth/can"

export const metadata: Metadata = { title: "Importar historial anterior" }
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
        title="Importar historial anterior"
        description="Incorpora los trabajos de los formularios anteriores conservando sus datos de origen."
        breadcrumb={[
          { label: "Control operacional", href: "/control-operacional" },
          { label: "Mantención" },
          { label: "Registros firmados", href: "/mantencion/registros" },
          { label: "Historial anterior", href: "/mantencion/registros/historicos" },
          { label: "Importar" },
        ]}
      />
      <HistoricalImportPanel />
    </PageContainer>
  )
}
