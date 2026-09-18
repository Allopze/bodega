import type { Metadata } from "next"
import Link from "next/link"
import { redirect, notFound } from "next/navigation"
import { and, eq, inArray } from "drizzle-orm"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  getPdtpProgram,
  listPdtpProgramSheets,
  listPdtpProgramActivities,
  listPdtpProgramScheduleForYear,
  listProgramActiveChecklists,
  listPdtpResponsibleCatalog,
  listPdtpProgramWorksites,
  listPdtpActivityWorksiteExclusions,
  listPdtpActivityWorksiteParams,
  loadPdtpOverrides,
  comparePdtpProgramToSourceBase,
  comparePdtpRevisionToCurrentBase,
  listPdtpRevisionDiffDecisions,
  getPdtpCoverageReport,
  listPdtpActivityExecutorAssignments,
  listPdtpExecutorRoleOptions,
  listPdtpObjectives,
} from "@/lib/services/prevention-pdtp"
import { db } from "@/db"
import { worksites } from "@/db/schema"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { PdtpBuilderTabs } from "./builder-tabs"
import { resolvePdtpActivitiesReturnHref } from "../../pdtp-context"
import { listCatalogActivities } from "@/lib/services/pdtp/catalog-activities"

export const metadata: Metadata = { title: "Editar programa PDTP" }

type Props = {
  params: Promise<{ programId: string }>
  searchParams: Promise<{ volver?: string | string[]; seccion?: string | string[] }>
}

export default async function PdtpEditProgramPage({ params, searchParams }: Props) {
  let session
  try { session = await requireAuth() }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/pdtp/[programId]/editar")}`) }
  if (!can(session, "prevention:pdtp:program:manage")) redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/pdtp/[programId]/editar")}`)

  const { programId } = await params
  const query = await searchParams
  const returnHref = resolvePdtpActivitiesReturnHref(Array.isArray(query.volver) ? query.volver[0] : query.volver)
  const initialSection = Array.isArray(query.seccion) ? query.seccion[0] : query.seccion
  const program = await getPdtpProgram(programId)
  if (!program) notFound()
  if (program.status !== "draft") redirect(`/prevencion/pdtp/${programId}`)

  const worksiteScope = resolveWorksiteScope(session)
  const [sheets, activities, checklists, responsibleCatalog, catalogActivities, visibleWorksites, programWorksites, baseComparison, coverageReport, executorAssignments, executorRoleOptions, objectives] = await Promise.all([
    listPdtpProgramSheets(programId),
    listPdtpProgramActivities(programId),
    listProgramActiveChecklists(programId),
    listPdtpResponsibleCatalog(),
    listCatalogActivities(),
    worksiteScope.mode === "none"
      ? Promise.resolve([])
      : db.select({ id: worksites.id, name: worksites.name, code: worksites.code }).from(worksites)
          .where(worksiteScope.mode === "all"
            ? eq(worksites.isActive, true)
            : and(eq(worksites.isActive, true), inArray(worksites.id, worksiteScope.ids)))
          .orderBy(worksites.name),
    listPdtpProgramWorksites(programId),
    program.version > 1
      ? comparePdtpRevisionToCurrentBase(programId)
      : comparePdtpProgramToSourceBase(programId),
    getPdtpCoverageReport(
      programId,
      worksiteScope.mode === "all" ? undefined : { worksiteIds: worksiteScope.ids },
    ),
    listPdtpActivityExecutorAssignments(programId),
    listPdtpExecutorRoleOptions(),
    listPdtpObjectives(programId),
  ])
  const activityIds = activities.map((activity) => activity.id)
  const [activityWorksiteExclusions, schedule, activityWorksiteParams, activityScheduleOverrides] = await Promise.all([
    listPdtpActivityWorksiteExclusions(programId),
    listPdtpProgramScheduleForYear(activityIds, program.year),
    listPdtpActivityWorksiteParams(activityIds),
    loadPdtpOverrides(activityIds, program.year),
  ])
  const revisionDiffDecisions = program.version > 1 && baseComparison
    && "baseTemplateVersionId" in baseComparison
    && typeof baseComparison.baseTemplateVersionId === "string"
    ? await listPdtpRevisionDiffDecisions(programId, baseComparison.baseTemplateVersionId)
    : []

  return (
    <PageContainer>
      <PageHeader
        title={`Editar: ${program.title}`}
        description="Gestiona actividades, ajustes por faena y la revisión del programa anual."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Programas PDTP", href: "/prevencion/pdtp" },
            { label: program.title, href: `/prevencion/pdtp/${programId}` },
            { label: "Editar" },
          ]} />
        }
        actions={returnHref ? <Button asChild size="sm" variant="secondary"><Link href={returnHref}>Volver a actividades</Link></Button> : undefined}
      />
      <PdtpBuilderTabs
        key={initialSection ?? "default"}
        program={program}
        sheets={sheets}
        activities={activities}
        schedule={schedule}
        checklists={checklists}
        objectives={objectives}
        responsibleCatalog={responsibleCatalog.filter((responsible) => responsible.isActive)}
        catalogActivities={catalogActivities.map((activity) => ({
          id: activity.id,
          code: activity.code,
          title: activity.title,
          description: activity.description,
          executionGuidance: activity.executionGuidance,
          status: activity.status as "draft" | "active" | "retired",
          currentRevision: activity.currentRevision,
        }))}
        visibleWorksites={visibleWorksites}
        canManageWorksiteMembership={worksiteScope.mode === "all"}
        memberWorksiteIds={programWorksites.map((w) => w.worksiteId)}
        activityWorksiteExclusions={activityWorksiteExclusions}
        activityWorksiteParams={activityWorksiteParams}
        activityScheduleOverrides={activityScheduleOverrides}
        userId={session.user.id}
        canDelete={can(session, "prevention:pdtp:program:manage")}
        baseComparison={baseComparison}
        coverageIssues={coverageReport.groups.flatMap((group) => group.issues)}
        executorAssignments={executorAssignments}
        executorRoleOptions={executorRoleOptions}
        revisionDiffDecisions={revisionDiffDecisions}
        initialStep={initialSection}
      />
    </PageContainer>
  )
}
