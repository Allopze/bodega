import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { getAllTemplates } from "@/lib/services/email-templates"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { TemplateList } from "./template-list"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Plantillas de correo" }

export default async function PlantillasPage() {
  try { await requirePermission("admin:config") }
  catch { redirect("/forbidden") }

  const templates = await getAllTemplates()

  return (
    <PageContainer>
      <PageHeader
        title="Plantillas de correo"
        description="Personaliza el asunto y cuerpo HTML de los correos que envía el sistema."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Administración", href: "/admin" },
            { label: "Plantillas" },
          ]} />
        }
      />
      <TemplateList templates={templates.map((t) => ({
        id:        t.id,
        key:       t.key,
        name:      t.name,
        subject:   t.subject,
        bodyHtml:  t.bodyHtml,
        isDefault: t.isDefault,
        updatedAt: t.updatedAt,
      }))} />
    </PageContainer>
  )
}
