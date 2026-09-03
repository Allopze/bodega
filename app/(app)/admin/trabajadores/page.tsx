import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { workers, worksites } from "@/db/schema"
import { and, eq } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { HeaderSignals, type HeaderSignal } from "@/components/ui/header-signals"
import { WorkerActions } from "./worker-actions"
import { WorkerList } from "./worker-list"
import { getSizeFamilyOptions } from "@/lib/services/sizes"

export const metadata: Metadata = { title: "Trabajadores" }

export default async function TrabajadoresPage() {
  let session
  try { session = await requirePermission("admin:workers") }
  catch { redirect("/forbidden") }

  const [allWorkers, allWorksites, sizeFamilies] = await Promise.all([
    db.query.workers.findMany({
      with:    { worksite: true },
      where:   worksiteScopeSql(session, workers.worksiteId),
      orderBy: (w, { asc }) => [asc(w.lastName), asc(w.firstName)],
    }),
    db.query.worksites.findMany({
      where: and(eq(worksites.isActive, true), worksiteScopeSql(session, worksites.id)),
      orderBy: (ws, { asc }) => [asc(ws.name)],
    }),
    // Las tallas del padrón salen de `size_catalog`, la misma fuente que usa el
    // asistente de variantes: sin eso el padrón y el catálogo se separaban.
    getSizeFamilyOptions(),
  ])

  const activeCount = allWorkers.filter((w) => w.isActive).length
  const inactiveCount = allWorkers.length - activeCount
  const faenaCount = new Set(allWorkers.map((w) => w.worksiteId)).size
  // Solo "Inactivos" es accionable (revisar/borrar). Activos/faenas son
  // info: van en la descripción del título, no como chips en el TopBar.
  const headerSignals: HeaderSignal[] = [
    { key: "inactive", label: "Inactivos", value: inactiveCount, tone: "signal" },
  ]
  const description = allWorkers.length > 0
    ? `${allWorkers.length} trabajadores · ${activeCount} activos · ${faenaCount} faenas`
    : "Registro de trabajadores por faena para entrega de EPP y trazabilidad."

  return (
    <PageContainer>
      <PageHeader
        title="Trabajadores"
        description={description}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Administración", href: "/admin" },
            { label: "Trabajadores" },
          ]} />
        }
        headerActions={<HeaderSignals signals={headerSignals} />}
        actions={<WorkerActions worksites={allWorksites.map((ws) => ({ id: ws.id, name: ws.name }))} sizeFamilies={sizeFamilies} />}
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
          sizeTop:      w.sizeTop,
          sizeBottom:   w.sizeBottom,
          sizeShoe:     w.sizeShoe,
          sizeGloves:   w.sizeGloves,
          sizeHelmet:   w.sizeHelmet,
        }))}
        worksites={allWorksites.map((ws) => ({ id: ws.id, name: ws.name }))}
        sizeFamilies={sizeFamilies}
      />
    </PageContainer>
  )
}
