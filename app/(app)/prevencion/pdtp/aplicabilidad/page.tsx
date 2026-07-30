import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { db } from "@/db"
import { pdtpActivities, pdtpActivityWorksiteExclusions, pdtpActivityWorksiteParams, pdtpPrograms, worksites } from "@/db/schema"
import { and, eq, inArray, sql } from "drizzle-orm"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PdtpAplicabilidadClient, type ExclusionsMap, type ParamsMap } from "./pdtp-aplicabilidad-client"

export const metadata: Metadata = { title: "Aplicabilidad por Faena — PDTP SG-SST" }

export default async function PdtpAplicabilidadPage() {
  let session
  try {
    session = await requireAuth()
  } catch {
    redirect("/forbidden")
  }

  if (!can(session, "prevention:pdtp:view")) redirect("/forbidden")
  const canManage = can(session, "prevention:pdtp:program:manage")

  // Obtener el programa activo actual
  const programs = await db.select().from(pdtpPrograms)
    .where(eq(pdtpPrograms.status, "active"))
    .limit(1)

  const program = programs[0]
  if (!program) {
    return (
      <PageContainer>
        <PageHeader title="Aplicabilidad por Faena" description="Sin programa PDTP activo en el sistema." />
        <div className="p-8 text-center text-[var(--color-text-muted)]">No hay un programa PDTP activo para configurar aplicabilidad.</div>
      </PageContainer>
    )
  }

  // Lista de actividades del programa
  const activities = await db.select({
    id: pdtpActivities.id,
    n: pdtpActivities.n,
    activity: pdtpActivities.activity,
    scheduleMode: pdtpActivities.scheduleMode,
    indicatorMode: pdtpActivities.indicatorMode,
  })
    .from(pdtpActivities)
    .where(eq(pdtpActivities.programId, program.id))
    .orderBy(pdtpActivities.n)

  // Scope de faenas del usuario con conteo de trabajadores activos
  const scope = resolveWorksiteScope(session)
  const scopedWorksites = await db.select({
    id: worksites.id,
    name: worksites.name,
    code: worksites.code,
    workerCount: sql<number>`(SELECT COUNT(*)::int FROM workers w WHERE w.worksite_id = ${worksites.id} AND w.is_active = true)`,
  })
    .from(worksites)
    .where(scope.mode === "some" ? inArray(worksites.id, scope.ids) : scope.mode === "all" ? sql`true` : sql`false`)
    .orderBy(worksites.name)

  const activityIds = activities.map((a) => a.id)
  const worksiteIds = scopedWorksites.map((w) => w.id)

  // Exclusiones registradas
  const exclusionsRows = activityIds.length > 0 && worksiteIds.length > 0
    ? await db.select().from(pdtpActivityWorksiteExclusions)
        .where(and(inArray(pdtpActivityWorksiteExclusions.activityId, activityIds), inArray(pdtpActivityWorksiteExclusions.worksiteId, worksiteIds)))
    : []

  const exclusionsMap: ExclusionsMap = {}
  for (const row of exclusionsRows) {
    exclusionsMap[`${row.activityId}:${row.worksiteId}`] = { reason: row.reason }
  }

  // Parámetros por faena (R1 sujetos, R2 cobertura)
  const paramsRows = activityIds.length > 0 && worksiteIds.length > 0
    ? await db.select().from(pdtpActivityWorksiteParams)
        .where(and(inArray(pdtpActivityWorksiteParams.activityId, activityIds), inArray(pdtpActivityWorksiteParams.worksiteId, worksiteIds)))
    : []

  const paramsMap: ParamsMap = {}
  for (const row of paramsRows) {
    paramsMap[`${row.activityId}:${row.worksiteId}`] = {
      expectedSubjectCount: row.expectedSubjectCount,
      targetCoveragePercent: row.targetCoveragePercent != null ? Number(row.targetCoveragePercent) : null,
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Aplicabilidad y Reglas por Faena (PDTP)"
        description={`Programa anual ${program.year}: gestiona exclusiones, sujetos esperados y metas de cobertura por faena.`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Prevención", href: "/prevencion" },
            { label: "Programa PDTP", href: "/prevencion/pdtp" },
            { label: "Aplicabilidad por Faena" },
          ]} />
        }
      />

      <PdtpAplicabilidadClient
        activities={activities}
        worksites={scopedWorksites}
        exclusions={exclusionsMap}
        params={paramsMap}
        canManage={canManage}
      />
    </PageContainer>
  )
}
