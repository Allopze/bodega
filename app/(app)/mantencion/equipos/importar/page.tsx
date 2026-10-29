import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { EquipmentImportPanel } from "@/components/mantencion/jefatura/equipos/equipment-import-panel"
import { requirePermission } from "@/lib/auth/can"

export const metadata: Metadata = { title: "Importar equipos" }
export const dynamic = "force-dynamic"

export default async function ImportEquipmentPage() {
  try {
    await requirePermission("mant:equipment:manage")
  } catch {
    redirect("/forbidden")
  }
  return (
    <PageContainer width="form">
      <PageHeader
        title="Importar equipos"
        description="Carga equipos y sus lecturas iniciales desde una planilla de Excel."
        breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Equipos", href: "/mantencion/equipos" }, { label: "Importar" }]}
      />
      <EquipmentImportPanel />
    </PageContainer>
  )
}
