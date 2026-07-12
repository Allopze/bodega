import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { worksites } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope, worksiteScopeSql } from "@/lib/auth/scope"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { Buildings, CheckCircle, PauseCircle, MapPin } from "@phosphor-icons/react/dist/ssr"
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
  const canCreateWorksites = resolveWorksiteScope(session).mode === "all"

  const activeCount = allWorksites.filter((w) => w.isActive).length
  const regionCount = new Set(allWorksites.flatMap((w) => w.region ? [w.region] : [])).size
  const summaryStats: SummaryStat[] = [
    { key: "total",    label: "Faenas",    value: allWorksites.length,             icon: <Buildings size={13} /> },
    { key: "active",   label: "Activas",   value: activeCount,                     icon: <CheckCircle size={13} /> },
    { key: "inactive", label: "Inactivas", value: allWorksites.length - activeCount, icon: <PauseCircle size={13} /> },
    { key: "regions",  label: "Regiones",  value: regionCount,                     icon: <MapPin size={13} /> },
  ]

  return (
    <PageContainer>
      <PageHeader
        title="Faenas"
        description="Configura las faenas activas de la organización."
        breadcrumb={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Faenas" },
        ]}
        actions={canCreateWorksites ? <FaenasActions /> : undefined}
      />
      {allWorksites.length > 0 && <SummaryBar className="mb-4" stats={summaryStats} />}
      <FaenasList
        worksites={allWorksites.map((w) => ({
          id: w.id, name: w.name, code: w.code,
          address: w.address, region: w.region,
          isActive: w.isActive, createdAt: w.createdAt, updatedAt: w.updatedAt,
        }))}
        canCreateWorksites={canCreateWorksites}
      />
    </PageContainer>
  )
}
