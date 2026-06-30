import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getStockThresholds } from "@/lib/services/prevention-epp-matrix"
import { listScopedWorksites } from "@/lib/services/ppa"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PreventionExportButton } from "@/components/prevention/export-button"

export const metadata: Metadata = { title: "Stock crítico EPP" }

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export default async function EppStockPage({ searchParams }: { searchParams: Promise<{ faena?: string }> }) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:epp_stock:view")) redirect("/forbidden")

  const query = await searchParams
  const scope = scopeToIds(resolveWorksiteScope(session))
  const worksites = await listScopedWorksites(scope)
  const selectedWorksiteId = worksites.find((w) => w.id === query.faena)?.id ?? worksites[0]?.id

  let thresholds: Array<{ id: string; eppProductId: string; minStock: number; criticalStock: number }> = []
  if (selectedWorksiteId) {
    thresholds = await getStockThresholds(selectedWorksiteId, scope)
  }

  return (
    <PageContainer>
      <Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Stock EPP" }]} />
      <PageHeader title="Stock crítico EPP" description="Umbrales de stock mínimo y crítico por faena (N° 65 PDTP)" actions={<PreventionExportButton href={`/api/prevencion/epp/stock/export?faena=${selectedWorksiteId ?? ""}`} label="Exportar stock" />} />
      <div className="rounded border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left">EPP</th>
              <th className="px-3 py-2 text-right">Stock mínimo</th>
              <th className="px-3 py-2 text-right">Stock crítico</th>
            </tr>
          </thead>
          <tbody>
            {thresholds.length === 0 ? (
              <tr><td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">Sin umbrales configurados.</td></tr>
            ) : thresholds.map((t) => (
              <tr key={t.id} className="border-t">
                <td className="px-3 py-2">{t.eppProductId}</td>
                <td className="px-3 py-2 text-right">{t.minStock}</td>
                <td className="px-3 py-2 text-right">{t.criticalStock}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageContainer>
  )
}
