import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { db } from "@/db"
import { workers, worksites } from "@/db/schema/worksites"
import { asc, inArray, eq, and } from "drizzle-orm"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { NuevaEvaluacionForm } from "./nueva-evaluacion-form"
import { CHECKLIST_DEFINITIONS } from "@/lib/sst/definitions/index"
import { CARGO_OPTIONS } from "@/lib/sst/cargos"

export const metadata: Metadata = { title: "Nueva Evaluación SST" }

export default async function NuevaEvaluacionPage() {
  let session
  try { session = await requirePermission("sst:create") }
  catch { redirect("/prevencion") }

  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" =
    scope.mode === "all"  ? "all" :
    scope.mode === "some" ? scope.ids :
    []

  // Fetch visible worksites
  const allWorksites = await db.select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(
      worksiteIds === "all"
        ? eq(worksites.isActive, true)
        : worksiteIds.length > 0
          ? inArray(worksites.id, worksiteIds)
          : undefined
    )
    .orderBy(asc(worksites.name))

  // Fetch workers visible to this user (scoped by worksite, active only)
  const allWorkers = await db
    .select({ id: workers.id, firstName: workers.firstName, lastName: workers.lastName, rut: workers.rut, worksiteId: workers.worksiteId })
    .from(workers)
    .where(
      worksiteIds === "all"
        ? eq(workers.isActive, true)
        : worksiteIds.length > 0
          ? and(eq(workers.isActive, true), inArray(workers.worksiteId, worksiteIds))
          : undefined
    )
    .orderBy(asc(workers.firstName), asc(workers.lastName))

  const workerOptions = allWorkers.map((w) => ({
    id: w.id,
    name: `${w.firstName} ${w.lastName}`.trim(),
    rut: w.rut ?? "",
    worksiteId: w.worksiteId,
  }))

  const worksiteOptions = allWorksites.map((w) => ({ id: w.id, name: w.name }))

  const definicionOptions = Object.values(CHECKLIST_DEFINITIONS).map((d) => ({
    code: d.code,
    title: d.title,
    tipo: d.tipo,
  }))

  return (
    <PageContainer width="form">
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
