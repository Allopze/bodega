import type { Metadata } from "next"
import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope, worksiteScopeSql } from "@/lib/auth/scope"
import { db } from "@/db"
import { workers, worksites } from "@/db/schema"
import { and, eq, asc } from "drizzle-orm"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import {
  listAccessSystems, listWorkersWithAccess, listInactiveWorkersWithAccess,
  listChecklists, getChecklistsTasks, getEgressContexts,
} from "@/lib/services/ti/access"
import { AccessFilters } from "./access-filters"
import { AccessSystemsPanel, NewSystemCta } from "./access-systems-panel"
import { AccessMatrix } from "./access-matrix"
import { RegisterAccessCta } from "./access-sheets"
import { ChecklistsPanel, NewChecklistCta } from "./checklists-panel"
import { InactiveAccessReview } from "./inactive-access-review"
import { AccessViewTabs } from "./access-view-tabs"
import { ACCESS_VIEWS, type AccessView } from "./access-views"

export const metadata: Metadata = { title: "Accesos" }

function first(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined
}

export default async function AccesosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("ti:view") }
  catch { redirect("/forbidden") }

  const canManage = can(session, "ti:manage_access")
  const canRevokeLicenses = can(session, "ti:manage_licenses")
  const sp = await searchParams
  const workerScope = worksiteScopeSql(session, workers.worksiteId)
  const worksiteScope = worksiteScopeSql(session, worksites.id)
  const serviceScope = serviceWorksiteScope(session)

  // `?vista=` es el contrato con la navegación y el resumen de TI; un valor
  // desconocido cae en la pestaña por defecto en vez de dejar la página vacía.
  const requestedView = first(sp.vista)
  const view: AccessView = ACCESS_VIEWS.some((v) => v.value === requestedView)
    ? (requestedView as AccessView)
    : "accesos"
  const reviewInactive = view === "accesos" && sp.revision === "inactivos"
  const showAll = sp.todos === "1"

  const systems = await listAccessSystems({ includeInactive: true }, serviceScope)
  const activeSystems = systems.filter((s) => s.isActive)

  // La lista de trabajadores activos (para los selectores) se consulta una
  // sola vez y solo en las pestañas que la usan.
  const needsWorkers = view === "accesos" || view === "ingreso-egreso"
  const workersList = needsWorkers
    ? await db.select({ id: workers.id, name: workers.firstName, lastName: workers.lastName })
      .from(workers).where(and(eq(workers.isActive, true), workerScope)).orderBy(asc(workers.firstName), asc(workers.lastName))
    : []

  let header: ReactNode = undefined
  let body: ReactNode = null

  if (view === "accesos") {
    const [worksitesList, workersWithAccess, inactiveWithAccess] = await Promise.all([
      db.select({ id: worksites.id, name: worksites.name })
        .from(worksites).where(and(eq(worksites.isActive, true), worksiteScope)).orderBy(asc(worksites.name)),
      reviewInactive
        ? Promise.resolve([])
        : listWorkersWithAccess({
          systemId: first(sp.sistema),
          worksiteId: first(sp.faena),
          search: first(sp.q),
          includeWithoutAccess: showAll,
          scope: workerScope,
        }),
      listInactiveWorkersWithAccess(workerScope),
    ])

    header = canManage ? <RegisterAccessCta systems={activeSystems} workers={workersList} /> : undefined
    body = reviewInactive ? (
      <InactiveAccessReview workers={inactiveWithAccess} canManage={canManage} />
    ) : (
      <>
        <AccessFilters
          current={sp}
          worksites={worksitesList}
          systems={systems.map((system) => ({ id: system.id, name: system.name }))}
        />
        <AccessMatrix
          workers={workersWithAccess}
          systems={first(sp.sistema) ? activeSystems.filter((s) => s.id === first(sp.sistema)) : activeSystems}
          canManage={canManage}
          showAll={showAll}
          systemFiltered={Boolean(first(sp.sistema))}
          inactiveWithAccessCount={inactiveWithAccess.length}
        />
      </>
    )
  } else if (view === "ingreso-egreso") {
    const checklists = await listChecklists({ scope: workerScope })
    const tasksByChecklist = await getChecklistsTasks(checklists.map((c) => c.id))
    // El contexto vivo (accesos, licencias, equipos) solo importa en egresos
    // que siguen abiertos.
    const openEgressWorkerIds = [...new Set(
      checklists.filter((c) => c.kind === "offboarding" && !c.completedAt).map((c) => c.workerId),
    )]
    const contexts = await getEgressContexts(openEgressWorkerIds, workerScope)
    const checklistsWithTasks = checklists.map((checklist) => ({
      ...checklist,
      tasks: tasksByChecklist.get(checklist.id) ?? [],
      context: checklist.kind === "offboarding" && !checklist.completedAt
        ? contexts.get(checklist.workerId) ?? { accesses: [], licenses: [], assets: [] }
        : null,
    }))

    header = canManage ? <NewChecklistCta workers={workersList} /> : undefined
    body = (
      <ChecklistsPanel
        checklists={checklistsWithTasks}
        workers={workersList}
        canManage={canManage}
        canRevokeLicenses={canRevokeLicenses}
      />
    )
  } else {
    header = canManage && serviceScope === "all" ? <NewSystemCta /> : undefined
    body = <AccessSystemsPanel systems={systems} canManage={canManage && serviceScope === "all"} />
  }

  return (
    <PageContainer>
      <PageHeader
        title="Accesos"
        description="Qué sistemas tiene cada trabajador y cómo entra y sale la gente de TI. Nunca se almacenan contraseñas."
        breadcrumb={<Breadcrumbs items={[{ label: "TI", href: "/ti" }, { label: "Accesos" }]} />}
        actions={header}
      />

      <div className="space-y-5">
        <AccessViewTabs view={view} />
        {body}
      </div>
    </PageContainer>
  )
}
