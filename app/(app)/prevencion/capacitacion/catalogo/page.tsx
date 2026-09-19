import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  listAllCourseVersions,
  listCompetencyRequirements,
  listTrainingCourses,
  listTrainingWorksites,
  type TrainingAccess,
} from "@/lib/services/prevention-training"
import { listCatalogActivities } from "@/lib/services/pdtp/catalog-activities"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { TrainingCatalog } from "./training-catalog"

export const metadata: Metadata = { title: "Catálogo de cursos" }

/**
 * El catálogo de cursos, sus versiones y sus requisitos.
 *
 * Esta ruta era un `redirect()` a `/prevencion/capacitacion` con el comentario
 * "el alta libre del catálogo ya no es el flujo operativo", y el componente que
 * hace el ciclo `draft → in_review → approved → published` quedó sin ninguna
 * página que lo montara. La consecuencia la pagaba el programa de trabajo: el
 * informe de cobertura le decía al prevencionista que un curso no tenía versión
 * publicada, y no existía ninguna pantalla alcanzable donde publicarla.
 *
 * Se reactiva como destino de esa brecha, no como alta libre: la puerta normal
 * de capacitación sigue siendo el control anual de ocurrencias, y crear cursos
 * sigue exigiendo `prevention:training:manage`.
 */
export default async function TrainingCatalogPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requireAuth() }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/capacitacion/catalogo")}`) }
  if (!can(session, "prevention:training:view")) {
    redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/capacitacion/catalogo")}`)
  }

  /* Compatibilidad con los marcadores viejos: una URL con `faena`/`year` y sin
   * `tab`/`q` venía del flujo anterior y sigue yendo al control de ocurrencias. */
  const params = await searchParams
  const first = (key: string) => {
    const value = params?.[key]
    return typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined
  }
  if (!first("tab") && !first("q") && (first("faena") || first("year"))) {
    const legacy = new URLSearchParams()
    for (const key of ["faena", "year"]) {
      const value = first(key)
      if (value) legacy.set(key, value)
    }
    redirect(`/prevencion/capacitacion?${legacy.toString()}`)
  }

  const access: TrainingAccess = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }
  const [courses, versionRows, requirementRows, worksites, catalogActivities] = await Promise.all([
    listTrainingCourses(access),
    listAllCourseVersions(access),
    listCompetencyRequirements(access),
    listTrainingWorksites(access),
    listCatalogActivities(),
  ])

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Catálogo de cursos"
        description="Los cursos del programa, sus versiones y los requisitos de competencia. Una versión sólo habilita una actividad cuando está publicada."
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención", href: "/prevencion" },
          { label: "Capacitación", href: "/prevencion/capacitacion" },
          { label: "Catálogo de cursos" },
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
        versions={versionRows.map((row) => ({
          id: row.version.id,
          courseName: row.courseName,
          courseCode: row.courseCode,
          versionLabel: row.version.versionLabel,
          status: row.version.status,
          durationMinutes: row.version.durationMinutes,
          modality: row.version.modality,
          version: row.version.version,
          observationComment: row.version.observationComment,
        }))}
        requirements={requirementRows.map((row) => ({
          id: row.requirement.id,
          courseName: row.courseName,
          courseCode: row.courseCode,
          scopeType: row.requirement.scopeType,
          scopeValue: row.requirement.scopeValue,
          worksiteName: row.worksiteName,
          enforcement: row.requirement.enforcement,
          isActive: row.requirement.isActive,
        }))}
        worksites={worksites}
        canManage={can(session, "prevention:training:manage")}
        canApprove={can(session, "prevention:training:approve")}
        catalogActivities={catalogActivities.map((activity) => ({
          id: activity.id, code: activity.code, title: activity.title,
          description: activity.description, status: activity.status as "draft" | "active" | "retired",
        }))}
      />
    </PageContainer>
  )
}
