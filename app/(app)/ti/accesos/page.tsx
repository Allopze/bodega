import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope, worksiteScopeSql } from "@/lib/auth/scope"
import { db } from "@/db"
import { workers, worksites } from "@/db/schema"
import { and, eq, asc } from "drizzle-orm"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { listAccessSystems, listWorkersWithAccess, listChecklists, getChecklistsTasks } from "@/lib/services/ti/access"
import { AccessFilters } from "./access-filters"
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

  const tasksByChecklist = await getChecklistsTasks(checklists.map((c) => c.id))
  const checklistsWithTasks = checklists.map((checklist) => ({
    ...checklist,
    tasks: tasksByChecklist.get(checklist.id) ?? [],
  }))

  return (
    <PageContainer>
      <PageHeader
        title="Accesos"
        description="Qué sistemas tiene cada trabajador. Nunca se almacenan contraseñas."
        breadcrumb={<Breadcrumbs items={[{ label: "TI", href: "/ti" }, { label: "Accesos" }]} />}
      />

      <AccessFilters
        current={sp}
        worksites={worksitesList}
        systems={systems.map((system) => ({ id: system.id, name: system.name }))}
      />

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
