import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { and, count, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpPrograms,
  preventionEmergencyPlans,
  preventionInspectionRuns,
  preventionInspectionTemplates,
  preventionTrainingCourses,
  preventionTrainingCourseVersions,
  worksites,
} from "@/db/schema"
import {
  assertPdtpFulfillmentCoverage,
  type PdtpFulfillmentCoverageIssue,
} from "@/lib/services/pdtp/fulfillment"
import {
  classifyPdtp2026InspectionWiring,
  type InspectionWiringGap,
} from "@/lib/prevention/inspection-wiring"

/**
 * Diagnóstico del cableado entre el programa anual y los módulos que lo
 * acreditan.
 *
 * Nace de un hallazgo que estuvo meses a la vista sin que nadie lo viera: las
 * plantillas que declaran su actividad del PDTP estaban todas en borrador, y
 * las versiones vigentes —anteriores, sin números— seguían ejecutándose y
 * acreditando nada. La inspección se hacía, se cerraba, y el programa no se
 * enteraba. Nada fallaba.
 *
 * Estrictamente de lectura y **nunca sale con código 1**: es un diagnóstico,
 * no una compuerta. La compuerta es `assertPdtpFulfillmentCoverage`, que corre
 * al enviar el programa a revisión. Éste avisa antes, en cada despliegue, para
 * que el aviso llegue cuando todavía se puede hacer algo.
 */

export interface PdtpWiringReport {
  ok: boolean
  /** Actividades del programa sin ningún instrumento de inspección vigente. */
  activitiesWithoutApprovedInstrument: number[]
  inspectionGaps: InspectionWiringGap[]
  /**
   * Por cada vigente mal cableada, cuántas inspecciones ya se cerraron contra
   * ella. Es el número de acreditaciones perdidas en silencio.
   */
  lostRuns: { templateId: string; code: string; versionLabel: string; closedRuns: number; declares: number[] }[]
  /** Cursos del programa sin una versión publicada: no se les puede programar sesión. */
  coursesWithoutPublishedVersion: { code: string; name: string }[]
  /**
   * Lo que la compuerta de cumplimiento reporta hoy. `config_required` y
   * `code_gap` bloquean el envío del programa a revisión; `decision_required` y
   * `destination_review` sólo se muestran.
   */
  coverageIssues: PdtpFulfillmentCoverageIssue[]
  /**
   * Actividades de enganche cuyo responsable declarado no tiene el permiso del
   * acto que las acredita. **Es una lista para revisar, no una lista de
   * errores**: buena parte son segregación de deberes —quien redacta el plan de
   * emergencia no es quien lo firma—. Quien la revise decide cuáles son grants
   * faltantes y cuáles son la norma funcionando.
   */
  destinationsToReview: { n: number; activity: string; reason: string }[]
  /** Faenas del programa sin plan de emergencia: la N°83 y la N°84 no pueden acreditar. */
  worksitesWithoutEmergencyPlan: string[]
}

export async function findPdtpAccreditationWiringGaps(): Promise<PdtpWiringReport> {
  const templates = await db.select({
    id: preventionInspectionTemplates.id,
    code: preventionInspectionTemplates.code,
    versionLabel: preventionInspectionTemplates.versionLabel,
    status: preventionInspectionTemplates.status,
    sourceDefinitionCode: preventionInspectionTemplates.sourceDefinitionCode,
    pdtpActivityNumbers: preventionInspectionTemplates.pdtpActivityNumbers,
    executorOfRecord: preventionInspectionTemplates.executorOfRecord,
  }).from(preventionInspectionTemplates)

  const { gaps, activitiesWithoutApprovedInstrument } = classifyPdtp2026InspectionWiring(
    templates.map((row) => ({
      ...row,
      pdtpActivityNumbers: (row.pdtpActivityNumbers as number[] | null) ?? null,
    })),
  )

  // Cuántas inspecciones ya se cerraron contra una plantilla mal cableada. Es
  // el daño consumado, y no se puede recuperar: el motor no acredita hacia
  // atrás sin una decisión explícita.
  const lostRuns: PdtpWiringReport["lostRuns"] = []
  for (const gap of gaps) {
    if (gap.kind !== "silently_unwired" && gap.kind !== "orphan_approved") continue
    const [row] = await db.select({ total: count() })
      .from(preventionInspectionRuns)
      .where(and(
        eq(preventionInspectionRuns.templateId, gap.approved.id),
        inArray(preventionInspectionRuns.status, ["completed", "reviewed", "closed"]),
      ))
    const closedRuns = Number(row?.total ?? 0)
    if (closedRuns > 0) {
      lostRuns.push({
        templateId: gap.approved.id,
        code: gap.approved.code,
        versionLabel: gap.approved.versionLabel,
        closedRuns,
        declares: gap.kind === "silently_unwired" ? gap.draft.declares : [],
      })
    }
  }

  // Cursos del programa sin versión publicada. `createTrainingSession` la
  // exige, así que un curso creado por el script de datos todavía no se puede
  // dictar — y eso afecta a los doce, no sólo al que se acaba de agregar.
  const courses = await db.select({
    id: preventionTrainingCourses.id,
    code: preventionTrainingCourses.code,
    name: preventionTrainingCourses.name,
    numbers: preventionTrainingCourses.pdtpActivityNumbers,
  }).from(preventionTrainingCourses).where(eq(preventionTrainingCourses.isActive, true))
  const pdtpCourses = courses.filter((course) => ((course.numbers as number[] | null) ?? []).length > 0)
  const publishedVersions = pdtpCourses.length === 0 ? [] : await db.select({
    courseId: preventionTrainingCourseVersions.courseId,
  }).from(preventionTrainingCourseVersions).where(and(
    inArray(preventionTrainingCourseVersions.courseId, pdtpCourses.map((course) => course.id)),
    eq(preventionTrainingCourseVersions.status, "published"),
  ))
  const publishedCourseIds = new Set(publishedVersions.map((row) => row.courseId))
  const coursesWithoutPublishedVersion = pdtpCourses
    .filter((course) => !publishedCourseIds.has(course.id))
    .map((course) => ({ code: course.code, name: course.name }))

  // La compuerta real, no una copia de su predicado. Replicarlo era el mismo
  // defecto que este script vino a detectar: dos lugares que opinan sobre lo
  // mismo se desincronizan, y el que avisa termina mintiendo.
  const [program] = await db.select({ id: pdtpPrograms.id }).from(pdtpPrograms)
    .where(inArray(pdtpPrograms.status, ["active", "draft", "in_review"]))
    .orderBy(pdtpPrograms.year)
  let coverageIssues: PdtpFulfillmentCoverageIssue[] = []
  let worksitesWithoutEmergencyPlan: string[] = []

  if (program) {
    coverageIssues = await assertPdtpFulfillmentCoverage(program.id)
    const plans = await db.select({ worksiteId: preventionEmergencyPlans.worksiteId }).from(preventionEmergencyPlans)
    worksitesWithoutEmergencyPlan = await resolveWorksitesWithoutPlan(new Set(plans.map((row) => row.worksiteId)))
  }

  const destinationsToReview = coverageIssues
    .filter((issue) => issue.status === "destination_review")
    .map((issue) => ({ n: issue.n, activity: issue.activity, reason: issue.reason }))

  const ok = gaps.length === 0
    && activitiesWithoutApprovedInstrument.length === 0
    && coverageIssues.filter((issue) => issue.status !== "decision_required" && issue.status !== "destination_review").length === 0
    && worksitesWithoutEmergencyPlan.length === 0

  return {
    ok,
    activitiesWithoutApprovedInstrument,
    inspectionGaps: gaps,
    lostRuns,
    coursesWithoutPublishedVersion,
    coverageIssues,
    destinationsToReview,
    worksitesWithoutEmergencyPlan,
  }
}

async function resolveWorksitesWithoutPlan(withPlan: Set<string>): Promise<string[]> {
  const rows = await db.select({ id: worksites.id, name: worksites.name })
    .from(worksites).where(eq(worksites.isActive, true))
  return rows.filter((row) => !withPlan.has(row.id)).map((row) => row.name)
}

async function main() {
  const report = await findPdtpAccreditationWiringGaps()
  console.log(JSON.stringify(report, null, 2))
}

function getErrorCode(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined
  if (typeof error === "object" && error !== null && "code" in error) return String(error.code)
  if (typeof cause === "object" && cause !== null && "code" in cause) return String(cause.code)
  return ""
}

const invokedPath = process.argv[1]
const isDirectInvocation = invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)

if (isDirectInvocation) {
  main().then(
    () => process.exit(0),
    (error) => {
      if (getErrorCode(error) === "42P01") {
        console.log(JSON.stringify({
          ok: true,
          skipped: true,
          reason: "Las tablas del PDTP aún no existen; base nueva.",
        }, null, 2))
        process.exit(0)
      }
      console.error(error instanceof Error ? error.message : error)
      // Diagnóstico, no compuerta: un despliegue no se detiene porque el
      // informe no se pudo calcular.
      process.exit(0)
    },
  )
}
