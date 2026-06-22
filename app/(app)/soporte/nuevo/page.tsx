import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { ReportForm } from "./report-form"

export const metadata: Metadata = { title: "Nuevo reporte — Soporte" }

export default async function NuevoReportePage() {
  try { await requirePermission("feedback:create") }
  catch { redirect("/forbidden") }

  return (
    <PageContainer>
      <PageHeader
        title="Nuevo reporte"
        description="Envía un bug, consulta o sugerencia al equipo de desarrollo."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard",  href: "/dashboard" },
            { label: "Soporte",    href: "/soporte" },
            { label: "Nuevo reporte" },
          ]} />
        }
      />
      <ReportForm />
    </PageContainer>
  )
}
