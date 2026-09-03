import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { db } from "@/db"
import { workers, worksites } from "@/db/schema"
import { eq, asc } from "drizzle-orm"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
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

  const [systems, workersWithAccess, worksitesList, workersList, checklists] = await Promise.all([
    listAccessSystems({ includeInactive: true }),
    listWorkersWithAccess({
      systemId: typeof sp.sistema === "string" ? sp.sistema : undefined,
      worksiteId: typeof sp.faena === "string" ? sp.faena : undefined,
      search: typeof sp.q === "string" ? sp.q : undefined,
    }),
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites).where(eq(worksites.isActive, true)).orderBy(asc(worksites.name)),
    db.select({ id: workers.id, name: workers.firstName, lastName: workers.lastName })
      .from(workers).where(eq(workers.isActive, true)).orderBy(asc(workers.firstName), asc(workers.lastName)),
    listChecklists(),
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

      <div className="space-y-6">
        <AccessSystemsPanel systems={systems} canManage={canManage} />
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
