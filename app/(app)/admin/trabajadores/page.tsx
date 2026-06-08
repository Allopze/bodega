import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { WorkerList } from "./worker-list"

export const metadata: Metadata = { title: "Trabajadores" }

export default async function TrabajadoresPage() {
  try { await requirePermission("admin:workers") }
  catch { redirect("/dashboard") }

  const [allWorkers, allWorksites] = await Promise.all([
    db.query.workers.findMany({
      with:    { worksite: true },
      orderBy: (w, { asc }) => [asc(w.lastName), asc(w.firstName)],
    }),
    db.query.worksites.findMany({
      where: (ws, { eq }) => eq(ws.isActive, true),
      orderBy: (ws, { asc }) => [asc(ws.name)],
    }),
  ])

  return (
    <>
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
    </>
  )
}
