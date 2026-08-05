import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { getCompanyProfile, getPdfMaxSizeMb } from "@/lib/services/system-settings"
import { ConfigForm } from "./config-form"

export const metadata: Metadata = { title: "Configuración del Sistema" }

export default async function ConfiguracionPage() {
  try {
    await requirePermission("admin:config")
  } catch {
    redirect("/forbidden")
  }

  const [pdfMaxSizeMb, companyProfile] = await Promise.all([
    getPdfMaxSizeMb(),
    getCompanyProfile(),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Configuración del Sistema"
        description="Ajustar parámetros globales de Plataforma Chome."
        breadcrumb={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Configuración" },
        ]}
      />
      <ConfigForm initialPdfMaxSizeMb={pdfMaxSizeMb} initialCompanyProfile={companyProfile} />
    </PageContainer>
  )
}
