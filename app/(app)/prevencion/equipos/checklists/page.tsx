import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listEquipmentChecklists } from "@/lib/services/prevention-equipment"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PreventionExportButton } from "@/components/prevention/export-button"

export const metadata: Metadata = { title: "Checklists de equipos" }

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export default async function EquiposChecklistsPage({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:equipment_reports:view")) redirect("/forbidden")

  const query = await searchParams
  const scope = scopeToIds(resolveWorksiteScope(session))
  const items = await listEquipmentChecklists(scope, query.tipo)

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Equipos", href: "/prevencion/equipos/reportes" }, { label: "Checklists" }]} />
      <PageHeader title="Checklists de equipos" description="Contenedores, maquinaria, carros, bateas, taller/RESPEL (N° 27-30 PDTP)" actions={<PreventionExportButton href="/api/prevencion/equipos/checklists/export" label="Exportar checklists" />} />
      <div className="rounded border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left">Activo</th>
              <th className="px-3 py-2 text-left">Tipo</th>
              <th className="px-3 py-2 text-left">Faena</th>
              <th className="px-3 py-2 text-left">Estado</th>
              <th className="px-3 py-2 text-left">Cierre requerido</th>
              <th className="px-3 py-2 text-left">Fecha</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">Sin checklists.</td></tr>
            ) : items.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="px-3 py-2">{c.assetCode}</td>
                <td className="px-3 py-2">{c.kind}</td>
                <td className="px-3 py-2">{c.worksiteId}</td>
                <td className="px-3 py-2">{c.status}</td>
                <td className="px-3 py-2">{c.closeRequired ? "Sí" : "No"}</td>
                <td className="px-3 py-2">{c.performedAt?.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageContainer>
  )
}
