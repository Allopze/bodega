import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { getPdtpComplianceIndicators } from "@/lib/services/prevention-pdtp"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PreventionExportButton } from "@/components/prevention/export-button"

export const metadata: Metadata = { title: "Indicadores preventivos" }

export default async function KpisPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:kpis:view")) redirect("/forbidden")

  const indicators = await getPdtpComplianceIndicators(2026)

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "KPIs" }]} />
      <PageHeader title="Indicadores preventivos" description="Cumplimiento, tasa de frecuencia, gravedad y siniestralidad (N° 7 PDTP)" actions={<PreventionExportButton href="/api/prevencion/kpis/export" label="Exportar KPIs" />} />

      {indicators && (
        <>
          <div className="grid gap-4 md:grid-cols-4 mb-6">
            <div className="rounded border p-4">
              <p className="text-xs text-muted-foreground">Cumplimiento anual</p>
              <p className="text-h1 font-semibold">{indicators.annual.percent !== null ? `${Math.round(indicators.annual.percent * 100)}%` : "—"}</p>
            </div>
            <div className="rounded border p-4">
              <p className="text-xs text-muted-foreground">Meta</p>
              <p className="text-h1 font-semibold">{Math.round(indicators.target * 100)}%</p>
            </div>
            <div className="rounded border p-4">
              <p className="text-xs text-muted-foreground">Actividades planificadas</p>
              <p className="text-h1 font-semibold">{indicators.annual.planned}</p>
            </div>
            <div className="rounded border p-4">
              <p className="text-xs text-muted-foreground">Actividades ejecutadas</p>
              <p className="text-h1 font-semibold">{indicators.annual.executed}</p>
            </div>
          </div>

          <div className="rounded border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left">Período</th>
                  <th className="px-3 py-2 text-right">Planificadas</th>
                  <th className="px-3 py-2 text-right">Ejecutadas</th>
                  <th className="px-3 py-2 text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {indicators.monthly.map((m) => (
                  <tr key={m.month} className="border-t">
                    <td className="px-3 py-2">Mes {m.month}</td>
                    <td className="px-3 py-2 text-right">{m.planned}</td>
                    <td className="px-3 py-2 text-right">{m.executed}</td>
                    <td className="px-3 py-2 text-right">{m.percent !== null ? `${Math.round(m.percent * 100)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </PageContainer>
  )
}
