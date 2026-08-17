import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { listIncidentWorksites } from "@/lib/services/prevention-incidents"
import { todayInChile } from "@/lib/utils"
import { IncidentReportForm } from "./incident-report-form"

export const metadata: Metadata = { title: "Reportar incidente" }

// hourCycle h23 y no hour12:false — con es-CL este último rinde "24:15" a las
// 00:15 de Chile, y `<input type="time">` descarta ese valor: el formulario
// nacía con la hora vacía durante la primera hora de cada día.
const CHILE_TIME_FORMAT = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })

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
  const defaultDate = todayInChile(now)
  const defaultTime = CHILE_TIME_FORMAT.format(now)

  return (
    <PageContainer width="form">
      <PageHeader
        title="Reportar incidente"
        description="Captura rápida móvil, con cola offline e idempotencia al sincronizar. En fatal/grave, suspende y documenta medidas inmediatas."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Incidentes", href: "/prevencion/incidentes" },
          { label: "Reportar" },
        ]} />}
      />
      <IncidentReportForm worksites={worksites} defaultDate={defaultDate} defaultTime={defaultTime} />
    </PageContainer>
  )
}
