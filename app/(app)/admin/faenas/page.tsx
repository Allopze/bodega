import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { worksites } from "@/db/schema"
import { can, requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope, worksiteScopeSql } from "@/lib/auth/scope"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { listWorksiteAliases } from "@/lib/services/worksite-aliases"
import { isWorksiteKind } from "@/lib/services/worksite-kind"
import { countContractsByWorksite } from "@/lib/services/contracts/worksite-view"
import { HeaderSignals, type HeaderSignal } from "@/components/ui/header-signals"
import { FaenasList } from "./faenas-list"
import { FaenasActions } from "./faenas-actions"

export const metadata: Metadata = { title: "Faenas" }

export default async function FaenasPage() {
  let session
  try { session = await requirePermission("admin:worksites") }
  catch { redirect("/forbidden") }

  const allWorksites = await db.query.worksites.findMany({
    where: worksiteScopeSql(session, worksites.id),
    orderBy: (w, { asc }) => [asc(w.name)],
  })
  const contractCounts = await countContractsByWorksite(allWorksites.map((w) => w.id))
  const aliasRows = await listWorksiteAliases(db, allWorksites.map((w) => w.id))
  const aliasesByWorksite = new Map<string, Array<{ id: string; aliasText: string }>>()
  for (const row of aliasRows) {
    const list = aliasesByWorksite.get(row.worksiteId) ?? []
    list.push({ id: row.id, aliasText: row.aliasText })
    aliasesByWorksite.set(row.worksiteId, list)
  }
  const canCreateWorksites = resolveWorksiteScope(session).mode === "all"

  const activeCount = allWorksites.filter((w) => w.isActive).length
  const inactiveCount = allWorksites.length - activeCount
  const regionCount = new Set(allWorksites.flatMap((w) => w.region ? [w.region] : [])).size
  // Solo "Inactivas" es accionable (reactivar/limpiar); total/regiones van en descripción.
  const headerSignals: HeaderSignal[] = [
    { key: "inactive", label: "Inactivas", value: inactiveCount, tone: "signal" },
  ]
  const description = allWorksites.length > 0
    ? `${allWorksites.length} faenas · ${activeCount} activas · ${regionCount} regiones`
    : "Configura las faenas activas de la organización."

  return (
    <PageContainer>
      <PageHeader
        title="Faenas"
        description={description}
        breadcrumb={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Faenas" },
        ]}
        headerActions={<HeaderSignals signals={headerSignals} />}
        actions={canCreateWorksites ? <FaenasActions /> : undefined}
      />
      <FaenasList
        worksites={allWorksites.map((w) => ({
          id: w.id, name: w.name, code: w.code,
          address: w.address, region: w.region, commune: w.commune, adminContratoLabel: w.adminContratoLabel,
          contractCount: contractCounts.get(w.id) ?? 0,
          kind: isWorksiteKind(w.kind) ? w.kind : "operacion",
          aliases: aliasesByWorksite.get(w.id) ?? [],
          isActive: w.isActive, createdAt: w.createdAt, updatedAt: w.updatedAt,
        }))}
        canCreateWorksites={canCreateWorksites}
        canReturnStock={can(session, "warehouse:adjust_stock")}
      />
    </PageContainer>
  )
}
