import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listCommittees } from "@/lib/services/prevention-committees"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PreventionExportButton } from "@/components/prevention/export-button"

export const metadata: Metadata = { title: "Comités y reuniones" }

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export default async function ComitesPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:cphs:view")) redirect("/forbidden")

  const scope = scopeToIds(resolveWorksiteScope(session))
  const items = await listCommittees(scope)

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Comités" }]} />
      <PageHeader title="Comités y reuniones" description="CPHS, bipartito de capacitación, reuniones y acuerdos (N° 11-14 PDTP)" actions={<PreventionExportButton href="/api/prevencion/comites/export" label="Exportar comités" />} />
      <div className="rounded border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left">Faena</th>
              <th className="px-3 py-2 text-left">Tipo</th>
              <th className="px-3 py-2 text-left">Estado</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">Sin comités registrados.</td></tr>
            ) : items.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="px-3 py-2">{c.worksiteId}</td>
                <td className="px-3 py-2">{c.type}</td>
                <td className="px-3 py-2">{c.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageContainer>
  )
}
