import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { worksites } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope, worksiteScopeSql } from "@/lib/auth/scope"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
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
          { label: "Dashboard", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Faenas" },
        ]}
        headerActions={<HeaderSignals signals={headerSignals} />}
        actions={canCreateWorksites ? <FaenasActions /> : undefined}
      />
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
