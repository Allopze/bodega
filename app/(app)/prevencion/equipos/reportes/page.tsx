import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { inArray } from "drizzle-orm"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listEquipmentReports } from "@/lib/services/prevention-equipment"
import { listScopedWorksites } from "@/lib/services/ppa"
import { db } from "@/db"
import { workers } from "@/db/schema/worksites"
import { PageContainer } from "@/components/ui/page-container"
import { ReportePanel } from "./reporte-panel"

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

  const [reports, worksites] = await Promise.all([
    listEquipmentReports(scope, query.faena),
    listScopedWorksites(scope),
  ])

  const workerIds = Array.from(new Set(reports.map((r) => r.operatorWorkerId).filter(Boolean)))
  const workerRows = workerIds.length > 0
    ? await db
      .select({ id: workers.id, firstName: workers.firstName, lastName: workers.lastName })
      .from(workers)
      .where(inArray(workers.id, workerIds))
    : []
  const workerMap = Object.fromEntries(workerRows.map((w) => [w.id, w]))
  const reportsWithOperator = reports.map((r) => ({
    ...r,
    operator: workerMap[r.operatorWorkerId] ?? null,
  }))

  const canManage = can(session, "prevention:equipment_reports:manage")

  return (
    <PageContainer>
      <ReportePanel
        reports={reportsWithOperator}
        worksites={worksites}
        workers={workerRows}
        canManage={canManage}
      />
    </PageContainer>
  )
}
