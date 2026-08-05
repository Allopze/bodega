import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import {
  listAllCourseVersions,
  listCompetencyRequirements,
  listTrainingCourses,
  listTrainingWorksites,
} from "@/lib/services/prevention-training"
import { TrainingCatalog } from "./training-catalog"

export const metadata: Metadata = { title: "Catálogo de capacitación" }

export default async function CatalogoPage() {
  let session
  try { session = await requirePermission("prevention:training:view") }
  catch { redirect("/forbidden") }

  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }
  const [courses, versions, requirements, worksites] = await Promise.all([
    listTrainingCourses(access),
    listAllCourseVersions(access),
    listCompetencyRequirements(access),
    listTrainingWorksites(access),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Catálogo de capacitación"
        description="Cursos, contenidos versionados y requisitos de competencia. Un curso legal obligatorio debe cumplir el piso del DS 44 art. 16."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Capacitación", href: "/prevencion/capacitacion" },
          { label: "Catálogo" },
        ]} />}
      />
      <TrainingCatalog
        courses={courses.map((row) => ({
          id: row.course.id,
          code: row.course.code,
          name: row.course.name,
          kind: row.course.kind,
          minimumDurationMinutes: row.course.minimumDurationMinutes,
          validityMonths: row.course.validityMonths,
          requiresAssessment: row.course.requiresAssessment,
          passingScore: row.course.passingScore,
          legalBasis: row.course.legalBasis,
          publishedVersionLabel: row.publishedVersionLabel,
        }))}
        versions={versions.map((row) => ({
          id: row.version.id,
          courseName: row.courseName,
          versionLabel: row.version.versionLabel,
          status: row.version.status,
          durationMinutes: row.version.durationMinutes,
          modality: row.version.modality,
          version: row.version.version,
          observationComment: row.version.observationComment,
        }))}
        requirements={requirements.map((row) => ({
          id: row.requirement.id,
          courseName: row.courseName,
          scopeType: row.requirement.scopeType,
          scopeValue: row.requirement.scopeValue,
          worksiteName: row.worksiteName,
          enforcement: row.requirement.enforcement,
          isActive: row.requirement.isActive,
        }))}
        worksites={worksites}
        canManage={session.user.permissions.includes("prevention:training:manage")}
        canApprove={session.user.permissions.includes("prevention:training:approve")}
      />
    </PageContainer>
  )
}
