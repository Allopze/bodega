import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { DevicesTable } from "@/components/mantencion/jefatura/equipos/devices-table"
import { MechanicAppInstallDialog } from "@/components/mantencion/jefatura/shared/mechanic-app-install-dialog"
import { requirePermission } from "@/lib/auth/can"
import { listDeviceCredentials } from "@/lib/services/mantencion/device-credentials"

export const metadata: Metadata = { title: "Dispositivos de la app de mantención" }
export const dynamic = "force-dynamic"

export default async function DevicesPage() {
  try {
    await requirePermission("mant:devices:manage", "/mantencion/equipos")
  } catch {
    redirect("/forbidden")
  }
  const rows = await listDeviceCredentials()
  return (
    <PageContainer>
      <PageHeader
        title="Dispositivos de la app"
        description="Teléfonos y tablets con la app del mecánico conectada. Revocar un acceso lo desconecta sin borrar lo que la persona tiene sin enviar."
        breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Equipos", href: "/mantencion/equipos" }, { label: "Dispositivos" }]}
        actions={<MechanicAppInstallDialog />}
      />
      <DevicesTable rows={rows} canRevoke />
    </PageContainer>
  )
}
