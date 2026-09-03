import type { Metadata } from "next"
import { redirect } from "next/navigation"
import Link from "next/link"
import { can, requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope, worksiteScopeSql } from "@/lib/auth/scope"
import { db } from "@/db"
import { workers, worksites } from "@/db/schema"
import { and, eq, asc } from "drizzle-orm"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/field"
import { FilterSelect } from "../../combustibles/filter-select"
import { listAccessSystems, listWorkersWithAccess, listChecklists, getChecklistTasks } from "@/lib/services/ti/access"
import { AccessSystemsPanel } from "./access-systems-panel"
import { AccessMatrix } from "./access-matrix"
import { ChecklistsPanel } from "./checklists-panel"

export const metadata: Metadata = { title: "Accesos TI" }

export default async function AccesosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("ti:view") }
  catch { redirect("/forbidden") }

  const canManage = can(session, "ti:manage_access")
  const sp = await searchParams
  const workerScope = worksiteScopeSql(session, workers.worksiteId)
  const worksiteScope = worksiteScopeSql(session, worksites.id)
  const serviceScope = serviceWorksiteScope(session)
  const search = typeof sp.q === "string" ? sp.q : ""
  const selectedSystem = typeof sp.sistema === "string" ? sp.sistema : ""
  const selectedWorksite = typeof sp.faena === "string" ? sp.faena : ""

  const [systems, workersWithAccess, worksitesList, workersList, checklists] = await Promise.all([
    listAccessSystems({ includeInactive: true }, serviceScope),
    listWorkersWithAccess({
      systemId: typeof sp.sistema === "string" ? sp.sistema : undefined,
      worksiteId: typeof sp.faena === "string" ? sp.faena : undefined,
      search: typeof sp.q === "string" ? sp.q : undefined,
      scope: workerScope,
    }),
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites).where(and(eq(worksites.isActive, true), worksiteScope)).orderBy(asc(worksites.name)),
    db.select({ id: workers.id, name: workers.firstName, lastName: workers.lastName })
      .from(workers).where(and(eq(workers.isActive, true), workerScope)).orderBy(asc(workers.firstName), asc(workers.lastName)),
    listChecklists({ scope: workerScope }),
  ])

  const checklistsWithTasks = await Promise.all(
    checklists.map(async (checklist) => ({
      ...checklist,
      tasks: await getChecklistTasks(checklist.id),
    })),
  )

  return (
    <PageContainer>
      <PageHeader
        title="Accesos"
        description="Qué sistemas tiene cada trabajador. Nunca se almacenan contraseñas."
        breadcrumb={<Breadcrumbs items={[{ label: "TI", href: "/ti" }, { label: "Accesos" }]} />}
      />

      <form method="get" role="search" className="mb-6 grid gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 sm:grid-cols-[minmax(0,1fr)_220px_220px_auto] sm:items-end">
        <div>
          <Label htmlFor="ti-access-search">Buscar trabajador</Label>
          <Input id="ti-access-search" name="q" defaultValue={search} placeholder="Nombre o apellido" />
        </div>
        <div>
          <Label htmlFor="ti-access-worksite">Faena</Label>
          <FilterSelect name="faena" defaultValue={selectedWorksite} ariaLabel="Filtrar accesos por faena" options={worksitesList.map((worksite) => ({ value: worksite.id, label: worksite.name }))} placeholder="Todas" />
        </div>
        <div>
          <Label htmlFor="ti-access-system">Sistema</Label>
          <FilterSelect name="sistema" defaultValue={selectedSystem} ariaLabel="Filtrar accesos por sistema" options={systems.map((system) => ({ value: system.id, label: system.name }))} placeholder="Todos" />
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm">Aplicar</Button>
          {(search || selectedSystem || selectedWorksite) && (
            <Button asChild type="button" variant="ghost" size="sm"><Link href="/ti/accesos">Limpiar</Link></Button>
          )}
        </div>
      </form>

      <div className="space-y-6">
        <AccessSystemsPanel systems={systems} canManage={canManage && serviceScope === "all"} />
        <AccessMatrix
          workers={workersWithAccess}
          systems={systems.filter((s) => s.isActive)}
          worksites={worksitesList}
          workersList={workersList}
          canManage={canManage}
        />
        <ChecklistsPanel checklists={checklistsWithTasks} workers={workersList} canManage={canManage} />
      </div>
    </PageContainer>
  )
}
