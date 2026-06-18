import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { getCompanyProfile, getPdfMaxSizeMb } from "@/lib/services/system-settings"
import { getSmtpConfig } from "@/lib/services/smtp-settings"
import { ConfigForm } from "./config-form"
import { SmtpConfigSection } from "./smtp-config-form"

export const metadata: Metadata = { title: "Configuración del Sistema" }

export default async function ConfiguracionPage() {
  try {
    await requirePermission("admin:config")
  } catch {
    redirect("/forbidden")
  }

  const [pdfMaxSizeMb, companyProfile, smtpConfig] = await Promise.all([
    getPdfMaxSizeMb(),
    getCompanyProfile(),
    getSmtpConfig(),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Configuración del Sistema"
        description="Ajustar parámetros globales de Chome Solicitudes y Bodega."
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Administración", href: "/admin" },
              { label: "Configuración" },
            ]}
          />
        }
      />
      <ConfigForm initialPdfMaxSizeMb={pdfMaxSizeMb} initialCompanyProfile={companyProfile} initialSmtpConfig={smtpConfig} />
      <SmtpConfigSection initialSmtpConfig={smtpConfig} />
    </PageContainer>
  )
}
