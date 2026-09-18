/**
 * lib/services/pdtp-adapters/competency-gap-connector.ts
 *
 * N°57 — "Comunicación Efectiva". Plazo 30 días.
 *
 * El hecho que la hace exigible es la **brecha de competencia**: hay alguien a
 * quien un requisito le exige el curso y no lo tiene, o lo tuvo y se le venció.
 * No es programar la sesión: si el reloj partiera al programarla, el plazo lo
 * elegiría la misma persona que después responde por cumplirlo, y el indicador
 * de oportunidad sería trivial de aprobar. La brecha, en cambio, aparece sola.
 *
 * **Una obligación por persona y curso**, no por faena y período. Es la
 * diferencia que importa: una sesión que capacita a 12 de 20 cerraría el caso
 * único de la faena dejando ocho personas sin la competencia y sin que nadie lo
 * note. El cierre es un abanico sobre quienes efectivamente la obtuvieron, que
 * `closeTrainingSession` ya calcula (`granted`: asistió y aprobó, o no requería
 * evaluación).
 *
 * No escribe el número 57 en ninguna parte: resuelve qué cursos acreditan una
 * actividad `on_demand` medida por plazo, así que un curso nuevo que cargue una
 * actividad de esa forma queda cubierto sin tocar este archivo.
 */

import { and, desc, eq, inArray, isNotNull } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpPrograms, preventionTrainingCourses } from "@/db/schema"
import { computeCompetencyGapsForScope } from "@/lib/services/prevention-training-gaps"
import { chileDateParts } from "@/lib/utils"
import {
  countOutcome,
  emptySweepCounters,
  ensureSubjectObligation,
  reportSubjectObligation,
  resolvePdtpProgramActorUserId,
  type ObligationSweepCounters,
} from "./obligation-kit"

const SOURCE_TYPE = "competencia"

export function competencySubjectKey(workerId: string, courseId: string): string {
  return `worker:${workerId}:curso:${courseId}`
}

/** El episodio lleva el mes de detección, por la misma razón que la N°11. */
function episodeIdFor(workerId: string, courseId: string, occurredAt: string): string {
  const { year, month } = chileDateParts(occurredAt)
  return `${competencySubjectKey(workerId, courseId)}:${year}-${String(month).padStart(2, "0")}`
}

/**
 * Los números de actividad que un curso acredita **y** que se miden por plazo
 * de cierre a demanda — o sea, las que necesitan una obligación para existir en
 * el indicador. El resto de los cursos acredita directo y no pasa por acá.
 */
export async function loadObligationBackedCourseActivities(): Promise<Map<string, number[]>> {
  const [programs, courses] = await Promise.all([
    db.select({ id: pdtpPrograms.id }).from(pdtpPrograms).where(eq(pdtpPrograms.status, "active")),
    db.select({ id: preventionTrainingCourses.id, numbers: preventionTrainingCourses.pdtpActivityNumbers })
      .from(preventionTrainingCourses)
      .where(and(eq(preventionTrainingCourses.isActive, true), isNotNull(preventionTrainingCourses.pdtpActivityNumbers))),
  ])
  if (programs.length === 0 || courses.length === 0) return new Map()

  const declared = new Set<number>()
  for (const course of courses) for (const n of (course.numbers as number[] | null) ?? []) declared.add(n)
  if (declared.size === 0) return new Map()

  const activities = await db.select({ n: pdtpActivities.n })
    .from(pdtpActivities)
    .where(and(
      inArray(pdtpActivities.programId, programs.map((p) => p.id)),
      eq(pdtpActivities.status, "active"),
      eq(pdtpActivities.scheduleMode, "on_demand"),
      eq(pdtpActivities.indicatorMode, "closed_on_time"),
      inArray(pdtpActivities.n, [...declared]),
    ))
  const obligationBacked = new Set(activities.map((a) => a.n))
  if (obligationBacked.size === 0) return new Map()

  const byCourse = new Map<string, number[]>()
  for (const course of courses) {
    const numbers = ((course.numbers as number[] | null) ?? []).filter((n) => obligationBacked.has(n))
    if (numbers.length > 0) byCourse.set(course.id, numbers)
  }
  return byCourse
}

export type CompetencyGapSweepResult = ObligationSweepCounters & { gaps: number }

/**
 * Barrido diario. Se llama desde `runPreventionTrainingReminders`, **después**
 * de `expireLapsedCompetencies()`: primero caduca lo que caducó, después se
 * evalúa la brecha contra esa verdad.
 *
 * Abre por **toda** brecha activa del curso, no sólo las `blocking`: la
 * obligación es el compromiso del programa preventivo, y el `enforcement` es
 * otra política —la que decide si además se escala a CAPA—.
 */
export async function sweepCompetencyGapObligations(): Promise<CompetencyGapSweepResult> {
  const counters = emptySweepCounters()
  const byCourse = await loadObligationBackedCourseActivities()
  if (byCourse.size === 0) return { ...counters, gaps: 0 }

  const gaps = (await computeCompetencyGapsForScope({ mode: "all", ids: [] })).filter((gap) => byCourse.has(gap.courseId))
  if (gaps.length === 0) return { ...counters, gaps: 0 }

  const occurredAt = new Date().toISOString()
  // El actor se hereda del programa activo, una sola vez: es el mismo para todo
  // el barrido y resolverlo por brecha serían N consultas idénticas.
  // El barrido puede coexistir con programas activos de otros años. Elegir el
  // primer activo sin año/version dejaba obligaciones del año corriente
  // atribuidas al autor de una versión histórica.
  const occurredYear = chileDateParts(occurredAt).year
  const [program] = await db.select({ id: pdtpPrograms.id }).from(pdtpPrograms)
    .where(and(eq(pdtpPrograms.status, "active"), eq(pdtpPrograms.year, occurredYear)))
    .orderBy(desc(pdtpPrograms.version))
    .limit(1)
  const actorUserId = program ? await resolvePdtpProgramActorUserId(program.id) : null

  for (const gap of gaps) {
    for (const activityNumber of byCourse.get(gap.courseId) ?? []) {
      const outcome = await ensureSubjectObligation({
        activityNumber,
        worksiteId: gap.worksiteId,
        subjectKey: competencySubjectKey(gap.workerId, gap.courseId),
        sourceType: SOURCE_TYPE,
        sourceId: episodeIdFor(gap.workerId, gap.courseId, occurredAt),
        occurredAt,
        userId: actorUserId,
        sourceMetadata: {
          workerId: gap.workerId,
          courseId: gap.courseId,
          courseName: gap.courseName,
          gapType: gap.gapType,
          requirementId: gap.requirementId,
        },
      })
      countOutcome(counters, outcome)
    }
  }

  return { ...counters, gaps: gaps.length }
}

/**
 * Cierre en abanico: una sesión cerrada reporta la obligación de cada persona
 * que obtuvo la competencia, no una sola por la sesión.
 *
 * Convive con la acreditación directa de `onTrainingSessionClosed`, que se
 * mantiene intacta: el mismo conector sirve a once cursos que no pasan por
 * obligación.
 */
export async function onCompetencyObtained(input: {
  sessionId: string
  worksiteId: string
  courseId: string
  closedAt: string
  grantedWorkerIds: string[]
  userId: string
}): Promise<void> {
  if (input.grantedWorkerIds.length === 0) return
  const numbers = (await loadObligationBackedCourseActivities()).get(input.courseId) ?? []
  if (numbers.length === 0) return

  for (const activityNumber of numbers) {
    for (const workerId of input.grantedWorkerIds) {
      await reportSubjectObligation({
        activityNumber,
        worksiteId: input.worksiteId,
        subjectKey: competencySubjectKey(workerId, input.courseId),
        occurredAt: input.closedAt,
        evidenceText: `Sesión de capacitación cerrada: ${input.sessionId}`,
        userId: input.userId,
      })
    }
  }
}
