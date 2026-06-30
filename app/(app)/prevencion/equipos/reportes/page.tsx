import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listEquipmentReports } from "@/lib/services/prevention-equipment"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PreventionExportButton } from "@/components/prevention/export-button"

export const metadata: Metadata = { title: "Reportes diarios de equipos" }

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export default async function EquiposReportesPage({ searchParams }: { searchParams: Promise<{ faena?: string }> }) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:equipment_reports:view")) redirect("/forbidden")

  const query = await searchParams
  const scope = scopeToIds(resolveWorksiteScope(session))
  const reports = await listEquipmentReports(scope, query.faena)

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Equipos", href: "/prevencion/equipos/reportes" }, { label: "Reportes" }]} />
      <PageHeader title="Reportes diarios de equipos" description="Report de uso diario (N° 25-26 PDTP)" actions={<PreventionExportButton href="/api/prevencion/equipos/reportes/export" label="Exportar reportes" />} />
      <div className="rounded border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left">Equipo</th>
              <th className="px-3 py-2 text-left">Faena</th>
              <th className="px-3 py-2 text-left">Turno</th>
              <th className="px-3 py-2 text-left">Estado</th>
              <th className="px-3 py-2 text-left">Odómetro</th>
              <th className="px-3 py-2 text-left">Horómetro</th>
              <th className="px-3 py-2 text-left">Fecha</th>
            </tr>
          </thead>
          <tbody>
            {reports.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-4 text-center text-muted-foreground">Sin reportes.</td></tr>
            ) : reports.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2">{r.equipmentId}</td>
                <td className="px-3 py-2">{r.worksiteId}</td>
                <td className="px-3 py-2">{r.shift}</td>
                <td className="px-3 py-2">{r.status}</td>
                <td className="px-3 py-2">{r.odometer ?? "-"}</td>
                <td className="px-3 py-2">{r.hourmeter ?? "-"}</td>
                <td className="px-3 py-2">{r.reportedAt?.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageContainer>
  )
}
