import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { workers, worksites } from "@/db/schema"
import { and, eq } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { WorkerList } from "./worker-list"

export const metadata: Metadata = { title: "Trabajadores" }

export default async function TrabajadoresPage() {
  let session
  try { session = await requirePermission("admin:workers") }
  catch { redirect("/dashboard") }

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
      />
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
        }))}
        worksites={allWorksites.map((ws) => ({ id: ws.id, name: ws.name }))}
      />
    </PageContainer>
  )
}
