import type { Metadata } from "next"
import { redirect, notFound } from "next/navigation"
import { inArray } from "drizzle-orm"
import { requireAuth, can } from "@/lib/auth/can"
import { getPdtpProgram, listPdtpProgramSheets, listPdtpProgramActivities, listProgramActiveChecklists } from "@/lib/services/prevention-pdtp"
import { db } from "@/db"
import { pdtpActivitySchedule } from "@/db/schema"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PdtpBuilderTabs } from "./builder-tabs"

export const metadata: Metadata = { title: "Editar programa PDTP" }

type Props = { params: Promise<{ programId: string }> }

export default async function PdtpEditProgramPage({ params }: Props) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:pdtp:manage")) redirect("/forbidden")

  const { programId } = await params
  const program = await getPdtpProgram(programId)
  if (!program) notFound()
  if (program.status !== "draft") redirect(`/prevencion/pdtp/${programId}`)

  const [sheets, activities, checklists] = await Promise.all([
    listPdtpProgramSheets(programId),
    listPdtpProgramActivities(programId),
    listProgramActiveChecklists(programId),
  ])
  const schedule = activities.length > 0
    ? await db.select().from(pdtpActivitySchedule).where(inArray(pdtpActivitySchedule.activityId, activities.map((a) => a.id)))
    : []

  return (
    <PageContainer>
      <PageHeader
        title={`Editar: ${program.title}`}
        description={`Configura las hojas, objetivos, actividades y planificación del programa.`}
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
        userId={session.user.id}
        canDelete={can(session, "prevention:pdtp:manage")}
      />
    </PageContainer>
  )
}
