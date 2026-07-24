import type { Metadata } from "next"
import { redirect, notFound } from "next/navigation"
import { and, eq, inArray } from "drizzle-orm"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getPdtpProgram, listPdtpProgramSheets, listPdtpProgramActivities, listProgramActiveChecklists, listPdtpResponsibleCatalog, listPdtpProgramWorksites, listPdtpActivityWorksiteExclusions } from "@/lib/services/prevention-pdtp"
import { db } from "@/db"
import { pdtpActivitySchedule, worksites } from "@/db/schema"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PdtpBuilderTabs } from "./builder-tabs"

export const metadata: Metadata = { title: "Editar programa PDTP" }

type Props = { params: Promise<{ programId: string }> }

export default async function PdtpEditProgramPage({ params }: Props) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:pdtp:program:manage")) redirect("/forbidden")

  const { programId } = await params
  const program = await getPdtpProgram(programId)
  if (!program) notFound()
  if (program.status !== "draft") redirect(`/prevencion/pdtp/${programId}`)

  const worksiteScope = resolveWorksiteScope(session)
  const [sheets, activities, checklists, responsibleCatalog, visibleWorksites, programWorksites] = await Promise.all([
    listPdtpProgramSheets(programId),
    listPdtpProgramActivities(programId),
    listProgramActiveChecklists(programId),
    listPdtpResponsibleCatalog(),
    worksiteScope.mode === "none"
      ? Promise.resolve([])
      : db.select({ id: worksites.id, name: worksites.name, code: worksites.code }).from(worksites)
          .where(worksiteScope.mode === "all"
            ? eq(worksites.isActive, true)
            : and(eq(worksites.isActive, true), inArray(worksites.id, worksiteScope.ids)))
          .orderBy(worksites.name),
    listPdtpProgramWorksites(programId),
  ])
  const activityWorksiteExclusions = await listPdtpActivityWorksiteExclusions(programId)
  const schedule = activities.length > 0
    ? await db.select().from(pdtpActivitySchedule).where(inArray(pdtpActivitySchedule.activityId, activities.map((a) => a.id)))
    : []

  return (
    <PageContainer>
      <PageHeader
        title={`Editar: ${program.title}`}
        description={`Define los objetivos, actividades, su frecuencia y las evidencias del programa.`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Programas PDTP", href: "/prevencion/pdtp" },
            { label: program.title, href: `/prevencion/pdtp/${programId}` },
            { label: "Editar" },
          ]} />
        }
      />
      <PdtpBuilderTabs
        program={program}
        sheets={sheets}
        activities={activities}
        schedule={schedule}
        checklists={checklists}
        responsibleCatalog={responsibleCatalog.filter((responsible) => responsible.isActive)}
        visibleWorksites={visibleWorksites}
        memberWorksiteIds={programWorksites.map((w) => w.worksiteId)}
        activityWorksiteExclusions={activityWorksiteExclusions}
        userId={session.user.id}
        canDelete={can(session, "prevention:pdtp:program:manage")}
      />
    </PageContainer>
  )
}
