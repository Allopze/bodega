/**
 * INC-001: el buzón del canal público, visible donde se tría.
 *
 * Un canal de reporte que nadie mira no es un canal. Server component de sólo
 * lectura: muestra lo que llegó sin triar. Los reportes anónimos no traen —ni
 * pueden traer— nada que identifique a quien los envió.
 */
import { MetaBadge } from "@/components/states/state-badge"
import type { WorksiteScope } from "@/lib/auth/scope"
import {
  INCIDENT_REPORT_CATEGORY_LABELS,
  listPublicIncidentReports,
} from "@/lib/services/prevention-incident-reports"

export async function PublicIncidentReportsPanel({ scope }: { scope: WorksiteScope }) {
  const reports = await listPublicIncidentReports({ scope, status: "pending", limit: 20 })
  if (reports.length === 0) return null

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Reportes del canal del trabajador</h2>
        <MetaBadge meta={{ label: String(reports.length), variant: "warning" }} dot />
        <span className="text-sm text-[var(--color-text-muted)]">sin triar</span>
      </div>
      <ul className="mt-3 space-y-2">
        {reports.map((report) => (
          <li key={report.id} className="text-sm">
            <span className="font-medium">{report.code}</span>
            {" · "}
            {INCIDENT_REPORT_CATEGORY_LABELS[report.category] ?? report.category}
            {" · "}
            {report.occurredAt}
            {" · "}
            {report.isAnonymous ? "anónimo" : report.reporterName}
            <p className="text-xs text-[var(--color-text-muted)]">{report.location} — {report.narrative}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
