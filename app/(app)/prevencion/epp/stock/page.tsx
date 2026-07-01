import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getStockThresholds } from "@/lib/services/prevention-epp-matrix"
import { listScopedWorksites } from "@/lib/services/ppa"
import { PageContainer } from "@/components/ui/page-container"
import { EppStockPanel } from "./epp-stock-panel"

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
      <EppStockPanel
        thresholds={thresholds}
        worksiteId={selectedWorksiteId ?? ""}
        canManage={can(session, "prevention:epp_stock:manage")}
        exportHref={`/api/prevencion/epp/stock/export?faena=${selectedWorksiteId ?? ""}`}
      />
    </PageContainer>
  )
}
