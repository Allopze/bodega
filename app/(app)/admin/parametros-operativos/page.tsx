import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import {
  DEFAULT_OPS_SETTINGS,
  getOperationalSettings,
} from "@/lib/services/system-settings"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { OpsSettingsForm } from "./ops-settings-form"

export const metadata: Metadata = { title: "Parámetros operativos" }

export default async function OpsSettingsPage() {
  try {
    await requirePermission("admin:ops_settings")
  } catch {
    redirect("/forbidden")
  }

  const current = await getOperationalSettings()

  return (
    <PageContainer width="form">
      <PageHeader
        title="Parámetros operativos"
        description="Ajustes avanzados que gobiernan exportaciones, retención de notificaciones y límites de adjuntos."
        breadcrumb={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Parámetros operativos" },
        ]}
      />
      <OpsSettingsForm current={current} defaults={DEFAULT_OPS_SETTINGS} />
    </PageContainer>
  )
}
