import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { db } from "@/db"
import { pdtpActivities, pdtpActivityWorksiteAssignees, pdtpActivityWorksiteExclusions, pdtpActivityWorksiteParams, pdtpPrograms, users, worksites } from "@/db/schema"
import { and, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm"
import { todayInChile } from "@/lib/utils"
import { listPdtpProgramWorksites, resolveProgramWorksiteIds } from "@/lib/services/pdtp"
import { currentPdtpPeriod } from "@/lib/services/pdtp/period"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { PdtpAplicabilidadClient, type AssigneesMap, type ExclusionsMap, type ParamsMap } from "./pdtp-aplicabilidad-client"
import { CreatePdtpRevisionButton } from "../[programId]/create-pdtp-revision-button"

export const metadata: Metadata = { title: "Aplicabilidad por Faena (PDTP SG-SST)" }

export default async function PdtpAplicabilidadPage() {
  let session
  try {
    session = await requireAuth()
  } catch {
    redirect("/forbidden")
  }

  if (!can(session, "prevention:pdtp:view")) redirect("/forbidden")
  const canManage = can(session, "prevention:pdtp:program:manage")

  // La matriz es operativa para el período actual. Un programa histórico
  // activo de otro año no debe desplazar la versión vigente de este período.
  const period = currentPdtpPeriod()
  const programs = await db.select().from(pdtpPrograms)
    .where(and(eq(pdtpPrograms.status, "active"), eq(pdtpPrograms.year, period.year)))
    .orderBy(desc(pdtpPrograms.version))
    .limit(1)

  const program = programs[0]
  if (!program) {
    return (
      <PageContainer>
        <PageHeader
          title="Aplicabilidad por Faena"
          description="Sin programa PDTP activo en el sistema."
          breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Prevención", href: "/prevencion" }, { label: "Programa de trabajo", href: "/prevencion/pdtp" }, { label: "Aplicabilidad por Faena" }]} />}
        />
        <EmptyState
          title={`Sin programa preventivo activo para ${period.year}`}
          description="Crea o activa un programa anual antes de configurar exclusiones, sujetos y metas por faena."
          action={canManage ? <Button asChild><Link href="/prevencion/pdtp/nuevo">Crear programa</Link></Button> : undefined}
        />
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
  const programMembers = await listPdtpProgramWorksites(program.id)
  const effectiveWorksiteIds = resolveProgramWorksiteIds(
    programMembers.map((member) => member.worksiteId),
    scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : [],
    scopedWorksites.map((worksite) => worksite.id),
    program.appliesToAllWorksites,
  )
  const effectiveWorksiteIdSet = new Set(effectiveWorksiteIds)
  const effectiveWorksites = scopedWorksites.filter((worksite) => effectiveWorksiteIdSet.has(worksite.id))
  const worksiteIds = effectiveWorksites.map((worksite) => worksite.id)
  const hasUndeclaredActiveScope = program.status === "active"
    && !program.appliesToAllWorksites
    && programMembers.length === 0

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

  // Asignación nominal vigente hoy (Fase 5): quién responde por cada actividad
  // en cada faena. Sin asignado, la actividad la ven todos los del cargo.
  const today = todayInChile()
  const assigneeRows = activityIds.length > 0 && worksiteIds.length > 0
    ? await db.select({
        activityId: pdtpActivityWorksiteAssignees.activityId,
        worksiteId: pdtpActivityWorksiteAssignees.worksiteId,
        name: users.name,
      })
        .from(pdtpActivityWorksiteAssignees)
        .innerJoin(users, eq(users.id, pdtpActivityWorksiteAssignees.userId))
        .where(and(
          inArray(pdtpActivityWorksiteAssignees.activityId, activityIds),
          inArray(pdtpActivityWorksiteAssignees.worksiteId, worksiteIds),
          lte(pdtpActivityWorksiteAssignees.validFrom, today),
          or(
            isNull(pdtpActivityWorksiteAssignees.validUntil),
            sql`${pdtpActivityWorksiteAssignees.validUntil} >= ${today}`,
          ),
        ))
        .orderBy(users.name)
    : []

  const assigneesMap: AssigneesMap = {}
  for (const row of assigneeRows) {
    const key = `${row.activityId}:${row.worksiteId}`
    assigneesMap[key] = [...(assigneesMap[key] ?? []), row.name]
  }

  return (
    <PageContainer>
      <PageHeader
        title="Aplicabilidad y Reglas por Faena (PDTP)"
        description={`Programa anual ${program.year}: gestiona exclusiones, sujetos esperados y metas de cobertura por faena.`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Prevención", href: "/prevencion" },
            { label: "Programa de trabajo", href: "/prevencion/pdtp" },
            { label: "Aplicabilidad por Faena" },
          ]} />
        }
      />

      {effectiveWorksites.length === 0 ? (
        <EmptyState
          tone="warning"
          title={hasUndeclaredActiveScope ? "Alcance de faenas no declarado" : "Este programa no tiene faenas ejecutables en tu alcance"}
          description={hasUndeclaredActiveScope
            ? "Revisa la cobertura del programa: una versión sin membresías sólo puede operar si declara alcance corporativo. Mientras falte esa definición no se pueden configurar reglas por faena."
            : "No hay faenas de este programa dentro del alcance autorizado para esta sesión. Revisa la membresía o la asignación de faenas antes de configurar reglas."}
          action={hasUndeclaredActiveScope && canManage ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <CreatePdtpRevisionButton sourceProgramId={program.id} />
              <Button asChild size="sm" variant="secondary"><Link href={`/prevencion/pdtp/${program.id}`}>Revisar cobertura</Link></Button>
            </span>
          ) : <Button asChild size="sm"><Link href={`/prevencion/pdtp/${program.id}`}>Revisar cobertura del programa</Link></Button>}
        />
      ) : (
        <PdtpAplicabilidadClient
          activities={activities}
          worksites={effectiveWorksites}
          exclusions={exclusionsMap}
          params={paramsMap}
          assignees={assigneesMap}
          canManage={canManage}
        />
      )}
    </PageContainer>
  )
}
