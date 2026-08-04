import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { getEmailsEnabled } from "@/lib/services/system-settings"
import { getLastDeliveryTest, getResendStatus } from "@/lib/services/smtp-settings"
import { CorreoForms } from "./smtp-form"

export const metadata: Metadata = { title: "Configuración de Correo" }

export default async function CorreoSmtpPage() {
  try {
    await requirePermission("admin:smtp")
  } catch {
    redirect("/forbidden")
  }

  const [resendStatus, emailsEnabled, lastTest] = await Promise.all([
    getResendStatus(),
    getEmailsEnabled(),
    getLastDeliveryTest(),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Configuración de Correo"
        description="Estado del servicio de envío de correos y configuración global de notificaciones."
        breadcrumb={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Correo" },
        ]}
      />
      <CorreoForms resendStatus={resendStatus} initialEmailsEnabled={emailsEnabled} lastTest={lastTest} />
    </PageContainer>
  )
}
