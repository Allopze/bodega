import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listDrills, getOverdueEquipmentInspections } from "@/lib/services/prevention-emergency"
import { listScopedWorksites } from "@/lib/services/ppa"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PreventionExportButton } from "@/components/prevention/export-button"

export const metadata: Metadata = { title: "Emergencias y CGRD" }

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export default async function EmergenciasPage({ searchParams }: { searchParams: Promise<{ faena?: string }> }) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:emergency:view")) redirect("/forbidden")

  const query = await searchParams
  const scope = scopeToIds(resolveWorksiteScope(session))
  const worksites = await listScopedWorksites(scope)
  const selectedWs = worksites.find((w) => w.id === query.faena)?.id ?? worksites[0]?.id

  const [drills, overdue] = selectedWs
    ? await Promise.all([listDrills(scope), getOverdueEquipmentInspections(selectedWs, scope)])
    : [await listDrills(scope), [] as Array<{ id: string; kind: string; code: string; location: string }>]

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Emergencias" }]} />
      <PageHeader title="Emergencias y CGRD" description="Planes, simulacros, brigadas y equipos de emergencia (N° 79-84 PDTP)" actions={<PreventionExportButton href="/api/prevencion/emergencias/export" label="Exportar emergencias" />} />

      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <div className="rounded border p-4">
          <p className="text-xs text-muted-foreground">Simulacros {new Date().getFullYear()}</p>
          <p className="text-h1 font-semibold">{drills.length}</p>
        </div>
        <div className="rounded border p-4">
          <p className="text-xs text-muted-foreground">Equipos con inspección vencida</p>
          <p className="text-h1 font-semibold">{overdue.length}</p>
        </div>
        <div className="rounded border p-4">
          <p className="text-xs text-muted-foreground">Último simulacro</p>
          <p className="text-h1 font-semibold text-sm">
            {drills.find((d) => d.executedAt)?.executedAt?.slice(0, 10) ?? "Sin registro"}
          </p>
        </div>
      </div>

      <div className="rounded border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left">Tipo</th>
              <th className="px-3 py-2 text-left">Programado</th>
              <th className="px-3 py-2 text-left">Ejecutado</th>
              <th className="px-3 py-2 text-left">Asistentes</th>
              <th className="px-3 py-2 text-left">Efectividad</th>
            </tr>
          </thead>
          <tbody>
            {drills.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">Sin simulacros.</td></tr>
            ) : drills.map((d) => (
              <tr key={d.id} className="border-t">
                <td className="px-3 py-2">{d.type}</td>
                <td className="px-3 py-2">{d.scheduledAt?.slice(0, 10)}</td>
                <td className="px-3 py-2">{d.executedAt?.slice(0, 10) ?? "Pendiente"}</td>
                <td className="px-3 py-2">{d.attendees ?? "-"}</td>
                <td className="px-3 py-2">{d.effectiveness ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageContainer>
  )
}
