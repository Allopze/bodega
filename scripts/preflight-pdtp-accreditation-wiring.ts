import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { and, count, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpActivities,
  pdtpPrograms,
  pdtpResponsibleCatalog,
  permissions,
  preventionEmergencyPlans,
  preventionInspectionRuns,
  preventionInspectionTemplates,
  preventionTrainingCourses,
  preventionTrainingCourseVersions,
  rolePermissions,
  roles,
  worksites,
} from "@/db/schema"
import {
  assertPdtpFulfillmentCoverage,
  type PdtpFulfillmentCoverageIssue,
} from "@/lib/services/pdtp/fulfillment"
import { pdtpCoverageIssueBlocksLifecycle } from "@/lib/services/pdtp/lifecycle"
import {
  classifyPdtp2026InspectionWiring,
  type InspectionWiringGap,
} from "@/lib/prevention/inspection-wiring"
import {
  classifyPdtpResponsibleExecution,
  type ResponsibleExecutionReport,
} from "@/lib/services/pdtp/responsible-execution"
import { countPdtpFulfillmentBacklog } from "@/lib/services/pdtp/backlog"

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
  /** Todo lo que la compuerta de cumplimiento reporta hoy, sin filtrar. */
  coverageIssues: PdtpFulfillmentCoverageIssue[]
  /**
   * El subconjunto que de verdad frena el envío a revisión y la activación.
   * Aplica `pdtpCoverageIssueBlocksLifecycle`, la regla del servicio, en vez de
   * una copia escrita a mano acá: es `ok` lo que mide catálogo completo, y son
   * cosas distintas desde que faltar un curso, una plantilla, un plan o un mapa
   * dejó de impedir que el programa se firme y se active.
   */
  coverageIssuesBlockingLifecycle: PdtpFulfillmentCoverageIssue[]
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
  /**
   * La misma pregunta que `destinationsToReview`, mirada por persona en vez de
   * por actividad, y con la segregación declarada separada del resto.
   *
   * `destinationsToReview` sale de la compuerta y sólo ve las actividades cuyo
   * destino conoce; ésta recorre las 81 y además resume por rol —"declarado en
   * 15, puede ejecutar 2"— que es el número que hizo visible el problema del
   * supervisor de terreno. `null` si no hay ningún programa que mirar.
   */
  responsibleExecution: ResponsibleExecutionReport | null
  /**
   * Lo que el libro de cumplimiento (`pdtp_fulfillment_events`) tiene sin
   * resolver para el programa vigente. `null` si no hay ningún programa que
   * mirar, igual que `responsibleExecution`.
   */
  fulfillmentBacklog: {
    pending: number
    errored: number
    erroredWaitingOnActivation: number
    lastError: string | null
    digestDrift: boolean
  } | null
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
    minimumDurationMinutes: preventionTrainingCourses.minimumDurationMinutes,
  }).from(preventionTrainingCourses).where(eq(preventionTrainingCourses.isActive, true))
  const pdtpCourses = courses.filter((course) => ((course.numbers as number[] | null) ?? []).length > 0)
  const publishedVersions = pdtpCourses.length === 0 ? [] : await db.select({
    courseId: preventionTrainingCourseVersions.courseId,
    durationMinutes: preventionTrainingCourseVersions.durationMinutes,
  }).from(preventionTrainingCourseVersions).where(and(
    inArray(preventionTrainingCourseVersions.courseId, pdtpCourses.map((course) => course.id)),
    eq(preventionTrainingCourseVersions.status, "published"),
  ))
  const minimumDurationByCourseId = new Map(pdtpCourses.map((course) => [course.id, course.minimumDurationMinutes]))
  const publishedCourseIds = new Set(publishedVersions
    .filter((row) => row.durationMinutes >= (minimumDurationByCourseId.get(row.courseId) ?? Number.POSITIVE_INFINITY))
    .map((row) => row.courseId))
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

  let responsibleExecution: ResponsibleExecutionReport | null = null
  let fulfillmentBacklog: PdtpWiringReport["fulfillmentBacklog"] = null
  if (program) {
    coverageIssues = await assertPdtpFulfillmentCoverage(program.id)
    const plans = await db.select({ worksiteId: preventionEmergencyPlans.worksiteId }).from(preventionEmergencyPlans)
    worksitesWithoutEmergencyPlan = await resolveWorksitesWithoutPlan(new Set(plans.map((row) => row.worksiteId)))
    responsibleExecution = await buildResponsibleExecutionReport(program.id)
    fulfillmentBacklog = await countPdtpFulfillmentBacklog(program.id)
  }

  const destinationsToReview = coverageIssues
    .filter((issue) => issue.status === "destination_review")
    .map((issue) => ({ n: issue.n, activity: issue.activity, reason: issue.reason }))

  const coverageIssuesBlockingLifecycle = coverageIssues.filter((issue) => pdtpCoverageIssueBlocksLifecycle(issue.status))

  // Qué significa el `ok` de este preflight: **catálogo completo**, no "se
  // puede activar". Son dos preguntas distintas desde que `config_required` e
  // `instrument_required` dejaron de frenar el ciclo de vida — un curso, una
  // plantilla, un plan o un mapa que todavía no existe ya no impide firmar ni
  // activar, pero sigue siendo cableado que falta, y nombrarlo es exactamente
  // para lo que existe este script. Por eso `ok` se mantiene MÁS estricto que
  // la compuerta a propósito, y no usa `pdtpCoverageIssueBlocksLifecycle`.
  //
  // Lo que ya no se puede hacer es leer `ok: false` como "no se puede activar":
  // para esa pregunta está `coverageIssuesBlockingLifecycle`, más arriba, que
  // aplica la regla real del servicio.
  //
  // Cada condición es una fuente de gaps distinta; se listan una por línea a
  // propósito para que sumar una nueva no implique tocar ni reordenar las
  // anteriores.
  //
  // La N°1 (y cualquier otra que acredite al firmar el paso legal) queda en
  // `error` mientras el programa sigue `in_review` — es el hueco esperado
  // entre firmar y activar, no una brecha de cableado. Se sigue contando en
  // `errored` para que el número completo no desaparezca del reporte; sólo se
  // excluye de `ok`.
  const blockingErrored = fulfillmentBacklog === null
    ? 0
    : fulfillmentBacklog.errored - fulfillmentBacklog.erroredWaitingOnActivation
  // `decision_required` y `destination_review` no cuentan como cableado
  // faltante: el padrón manual es una decisión válida y el mapa de destinos es
  // en buena parte segregación de deberes. Todo lo demás sí.
  const wiringGapIssues = coverageIssues.filter(
    (issue) => issue.status !== "decision_required" && issue.status !== "destination_review",
  )
  const ok = gaps.length === 0
    && activitiesWithoutApprovedInstrument.length === 0
    && wiringGapIssues.length === 0
    && worksitesWithoutEmergencyPlan.length === 0
    && (fulfillmentBacklog === null || (fulfillmentBacklog.pending === 0 && blockingErrored === 0))

  return {
    ok,
    activitiesWithoutApprovedInstrument,
    inspectionGaps: gaps,
    lostRuns,
    coursesWithoutPublishedVersion,
    coverageIssues,
    coverageIssuesBlockingLifecycle,
    destinationsToReview,
    worksitesWithoutEmergencyPlan,
    responsibleExecution,
    fulfillmentBacklog,
  }
}

/**
 * Los grants se leen de la base y no del manifest: el manifest es la semilla y
 * lo que decide si alguien entra es lo que `sync-rbac` dejó cargado. Mismo
 * criterio que `permissionsByRoleName` en la compuerta.
 */
async function buildResponsibleExecutionReport(programId: string): Promise<ResponsibleExecutionReport> {
  const [activities, catalog, grants] = await Promise.all([
    db.select({
      n: pdtpActivities.n,
      activity: pdtpActivities.activity,
      mechanism: pdtpActivities.mechanism,
      responsibleSlugs: pdtpActivities.responsibleSlugs,
    }).from(pdtpActivities).where(and(
      eq(pdtpActivities.programId, programId),
      eq(pdtpActivities.status, "active"),
    )),
    db.select().from(pdtpResponsibleCatalog),
    db.select({ role: roles.name, permission: permissions.name })
      .from(rolePermissions)
      .innerJoin(roles, eq(rolePermissions.roleId, roles.id))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id)),
  ])

  const permissionsByRole = new Map<string, Set<string>>()
  for (const grant of grants) {
    const set = permissionsByRole.get(grant.role) ?? new Set<string>()
    set.add(grant.permission)
    permissionsByRole.set(grant.role, set)
  }

  return classifyPdtpResponsibleExecution({
    activities: activities.map((row) => ({
      n: row.n,
      activity: row.activity,
      mechanism: row.mechanism,
      responsibleSlugs: (row.responsibleSlugs as string[] | null) ?? [],
    })),
    catalog: catalog.map((row) => ({
      slug: row.slug,
      roleName: row.roleName,
      operatedByRoleName: row.operatedByRoleName,
      isActive: row.isActive,
    })),
    permissionsByRole,
  })
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
