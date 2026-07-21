import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { workers, worksites } from "@/db/schema"
import { and, eq } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { SummaryBar, type SummaryStat } from "@/components/ui/summary-bar"
import { UsersThree, CheckCircle, PauseCircle, Buildings } from "@phosphor-icons/react/dist/ssr"
import { WorkerActions } from "./worker-actions"
import { WorkerList } from "./worker-list"

export const metadata: Metadata = { title: "Trabajadores" }

export default async function TrabajadoresPage() {
  let session
  try { session = await requirePermission("admin:workers") }
  catch { redirect("/forbidden") }

  const [allWorkers, allWorksites] = await Promise.all([
    db.query.workers.findMany({
      with:    { worksite: true },
      where:   worksiteScopeSql(session, workers.worksiteId),
      orderBy: (w, { asc }) => [asc(w.lastName), asc(w.firstName)],
    }),
    db.query.worksites.findMany({
      where: and(eq(worksites.isActive, true), worksiteScopeSql(session, worksites.id)),
      orderBy: (ws, { asc }) => [asc(ws.name)],
    }),
  ])

  const activeCount = allWorkers.filter((w) => w.isActive).length
  const faenaCount = new Set(allWorkers.map((w) => w.worksiteId)).size
  const summaryStats: SummaryStat[] = [
    { key: "total",    label: "Trabajadores", value: allWorkers.length,             icon: <UsersThree size={13} /> },
    { key: "active",   label: "Activos",      value: activeCount,                   icon: <CheckCircle size={13} /> },
    { key: "inactive", label: "Inactivos",    value: allWorkers.length - activeCount, icon: <PauseCircle size={13} /> },
    { key: "faenas",   label: "Faenas",       value: faenaCount,                    icon: <Buildings size={13} /> },
  ]

  return (
    <PageContainer>
      <PageHeader
        title="Trabajadores"
        description="Registro de trabajadores por faena para entrega de EPP y trazabilidad."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Administración", href: "/admin" },
            { label: "Trabajadores" },
          ]} />
        }
        actions={<WorkerActions worksites={allWorksites.map((ws) => ({ id: ws.id, name: ws.name }))} />}
      />
      {allWorkers.length > 0 && <SummaryBar className="mb-4" stats={summaryStats} />}
      <WorkerList
        workers={allWorkers.map((w) => ({
          id:           w.id,
          rut:          w.rut,
          firstName:    w.firstName,
          lastName:     w.lastName,
          position:     w.position,
          worksiteId:   w.worksiteId,
          worksiteName: w.worksite?.name ?? "—",
          isActive:     w.isActive,
          createdAt:    w.createdAt,
          sizeTop:      w.sizeTop,
          sizeBottom:   w.sizeBottom,
          sizeShoe:     w.sizeShoe,
          sizeGloves:   w.sizeGloves,
          sizeHelmet:   w.sizeHelmet,
        }))}
        worksites={allWorksites.map((ws) => ({ id: ws.id, name: ws.name }))}
      />
    </PageContainer>
  )
}
