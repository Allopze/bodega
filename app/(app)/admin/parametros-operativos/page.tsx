import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import {
  DEFAULT_OPS_SETTINGS,
  getOperationalSettings,
  getPdfEngineSettings,
} from "@/lib/services/system-settings"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { officeWorksiteOptions } from "@/lib/services/dispatch-guides"
import { OpsSettingsForm } from "./ops-settings-form"

export const metadata: Metadata = { title: "Parámetros operativos" }

export default async function OpsSettingsPage() {
  try {
    await requirePermission("admin:ops_settings")
  } catch {
    redirect("/forbidden")
  }

  const [current, office, pdfEngines] = await Promise.all([
    getOperationalSettings(),
    officeWorksiteOptions(),
    getPdfEngineSettings(),
  ])

  return (
    <PageContainer width="form">
      <PageHeader
        title="Parámetros operativos"
        description="Ajustes avanzados que gobiernan la bodega de origen, exportaciones, retención de notificaciones, límites de adjuntos y el motor de generación de PDF."
        breadcrumb={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Parámetros operativos" },
        ]}
      />
      <OpsSettingsForm current={current} defaults={DEFAULT_OPS_SETTINGS} office={office} pdfEngines={pdfEngines} />
    </PageContainer>
  )
}
