import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getEppMatrix } from "@/lib/services/prevention-epp-matrix"
import { listScopedWorksites } from "@/lib/services/ppa"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PreventionExportButton } from "@/components/prevention/export-button"

export const metadata: Metadata = { title: "Matriz EPP por cargo" }

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export default async function EppMatrizPage({ searchParams }: { searchParams: Promise<{ faena?: string }> }) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:epp_matrix:view")) redirect("/forbidden")

  const query = await searchParams
  const scope = scopeToIds(resolveWorksiteScope(session))
  const worksites = await listScopedWorksites(scope)
  const selectedWorksiteId = worksites.find((w) => w.id === query.faena)?.id ?? worksites[0]?.id

  let entries: Array<{ id: string; position: string; eppProductId: string; riskId: string | null; notes: string | null }> = []
  if (selectedWorksiteId) {
    entries = await getEppMatrix(selectedWorksiteId, scope)
  }

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Matriz EPP" }]} />
      <PageHeader title="Matriz EPP por cargo" description="Elementos de protección personal requeridos por cargo y faena (N° 61-62 PDTP)" actions={<PreventionExportButton href={`/api/prevencion/epp/matriz/export?faena=${selectedWorksiteId ?? ""}`} label="Exportar matriz" />} />
      <div className="rounded border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left">Cargo</th>
              <th className="px-3 py-2 text-left">EPP</th>
              <th className="px-3 py-2 text-left">Riesgo IPER</th>
              <th className="px-3 py-2 text-left">Notas</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">Sin entradas en la matriz.</td></tr>
            ) : entries.map((e) => (
              <tr key={e.id} className="border-t">
                <td className="px-3 py-2">{e.position}</td>
                <td className="px-3 py-2">{e.eppProductId}</td>
                <td className="px-3 py-2">{e.riskId ?? "-"}</td>
                <td className="px-3 py-2">{e.notes ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageContainer>
  )
}
