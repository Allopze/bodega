import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { listIncidentWorksites } from "@/lib/services/prevention-incidents"
import { IncidentReportForm } from "./incident-report-form"

export const metadata: Metadata = { title: "Reportar incidente" }

export default async function ReportIncidentPage() {
  let session
  try { session = await requirePermission("prevention:incidents:report") }
  catch { redirect("/forbidden") }
  const worksites = await listIncidentWorksites({
    ctx: { userId: session.user.id },
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }, "prevention:incidents:report")
  const now = new Date()
  const defaultDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
  const defaultTime = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit", hour12: false }).format(now)

  return (
    <PageContainer width="form">
      <PageHeader
        title="Reportar incidente"
        description="Captura rápida móvil, con cola offline e idempotencia al sincronizar. En fatal/grave, suspende y documenta medidas inmediatas."
        breadcrumb={<Breadcrumbs items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Incidentes", href: "/prevencion/incidentes" },
          { label: "Reportar" },
        ]} />}
      />
      <IncidentReportForm worksites={worksites} defaultDate={defaultDate} defaultTime={defaultTime} />
    </PageContainer>
  )
}
