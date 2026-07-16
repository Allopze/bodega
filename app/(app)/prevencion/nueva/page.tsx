import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, canAny, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { db } from "@/db"
import { workers, worksites } from "@/db/schema/worksites"
import { asc, inArray, eq, and } from "drizzle-orm"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { NuevaEvaluacionForm } from "./nueva-evaluacion-form"
import { CHECKLIST_DEFINITIONS, isPersonEvaluationDefinition } from "@/lib/sst/definitions/index"
import { CARGO_OPTIONS } from "@/lib/sst/cargos"
import { buildNuevaEvaluacionScope } from "./nueva-evaluacion-page.helpers"

export const metadata: Metadata = { title: "Nueva Evaluación SST" }

export default async function NuevaEvaluacionPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/prevencion") }
  if (!canAny(session, "sst:create", "sst:evaluate_acompanamiento")) redirect("/prevencion")

  const canCreateFullEvaluation = can(session, "sst:create")

  const { worksiteIds, hasRows } = buildNuevaEvaluacionScope(resolveWorksiteScope(session))

  // Fetch visible worksites
  const allWorksites = hasRows
    ? await db.select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(
        worksiteIds === "all"
          ? eq(worksites.isActive, true)
          : inArray(worksites.id, worksiteIds)
      )
      .orderBy(asc(worksites.name))
    : []

  // Fetch workers visible to this user (scoped by worksite, active only)
  const allWorkers = hasRows
    ? await db
      .select({ id: workers.id, firstName: workers.firstName, lastName: workers.lastName, rut: workers.rut, worksiteId: workers.worksiteId })
      .from(workers)
      .where(
        worksiteIds === "all"
          ? eq(workers.isActive, true)
          : and(eq(workers.isActive, true), inArray(workers.worksiteId, worksiteIds))
      )
      .orderBy(asc(workers.firstName), asc(workers.lastName))
    : []

  const workerOptions = allWorkers.map((w) => ({
    id: w.id,
    name: `${w.firstName} ${w.lastName}`.trim(),
    rut: w.rut ?? "",
    worksiteId: w.worksiteId,
  }))

  const worksiteOptions = allWorksites.map((w) => ({ id: w.id, name: w.name }))

  const definicionOptions = Object.values(CHECKLIST_DEFINITIONS)
    .filter((definition) => isPersonEvaluationDefinition(definition.code))
    .filter((d) => canCreateFullEvaluation || d.code === "trabajador_nuevo")
    .map((d) => ({
      code: d.code,
      title: d.title,
      tipo: d.tipo,
    }))

  return (
    <PageContainer width="workbench">
      <PageHeader
        title="Nueva Evaluación SST"
        description="Completa los datos para crear una nueva evaluación de seguridad."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard",        href: "/dashboard"   },
            { label: "Evaluaciones SST", href: "/prevencion"  },
            { label: "Nueva"                                   },
          ]} />
        }
      />
      <NuevaEvaluacionForm
        workers={workerOptions}
        worksites={worksiteOptions}
        definiciones={definicionOptions}
        cargoOptions={CARGO_OPTIONS}
      />
    </PageContainer>
  )
}
