import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope } from "@/lib/auth/scope"
import { FIELD_APPS } from "@/lib/apps/field-apps"
import { ACTIVE_WINDOW_MS } from "@/lib/apps/device-state"
import { getFieldAppSummaries } from "@/lib/services/field-apps/overview"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { formatDate } from "@/lib/utils"
import { FieldAppCard } from "./field-app-card"

export const metadata: Metadata = { title: "Apps" }

export default async function AppsPage() {
  let session
  try { session = await requirePermission("ti:view") }
  catch { redirect("/forbidden") }

  const now = new Date()
  const summaries = await getFieldAppSummaries(serviceWorksiteScope(session), now)
  const summaryOf = new Map(summaries.map((summary) => [summary.app, summary]))

  const since = summaries
    .map((summary) => summary.firstReportAt)
    .filter((value): value is string => value !== null)
    .sort()[0]
  const activeDays = Math.round(ACTIVE_WINDOW_MS / 86_400_000)

  return (
    <PageContainer>
      <PageHeader
        title="Apps"
        description="Las apps que se instalan en el teléfono: si funcionan y quién las usa."
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "TI", href: "/ti" }, { label: "Apps" }]} />}
      />
      <div className="space-y-4">
        <ul className="grid gap-4">
          {FIELD_APPS.map((app) => {
            const summary = summaryOf.get(app.id)
            return summary ? <li key={app.id}><FieldAppCard app={app} summary={summary} now={now} /></li> : null
          })}
        </ul>
        <p className="text-xs text-[var(--color-text-subtle)]">
          {since
            ? <>Los avisos de los teléfonos llegan desde el {formatDate(since)}.</>
            : <>Los avisos empiezan a llegar cuando alguien abre una app con la versión publicada.</>}
          {" "}Un teléfono activo es uno que avisó en los últimos {activeDays} días. Los envíos y los accesos salen de los registros de cada app.
        </p>
      </div>
    </PageContainer>
  )
}
