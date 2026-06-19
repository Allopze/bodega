import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { getEmailsEnabled } from "@/lib/services/system-settings"
import { getSmtpConfig } from "@/lib/services/smtp-settings"
import { SmtpPageForms } from "./smtp-form"

export const metadata: Metadata = { title: "Correo SMTP" }

export default async function CorreoSmtpPage() {
  try {
    await requirePermission("admin:config")
  } catch {
    redirect("/forbidden")
  }

  const [smtpConfig, emailsEnabled] = await Promise.all([
    getSmtpConfig(),
    getEmailsEnabled(),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Correo SMTP"
        description="Configura el servidor de correo saliente y el interruptor global de notificaciones."
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Administración", href: "/admin" },
              { label: "Correo SMTP" },
            ]}
          />
        }
      />
      <SmtpPageForms initialSmtpConfig={smtpConfig} initialEmailsEnabled={emailsEnabled} />
    </PageContainer>
  )
}
