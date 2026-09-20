/**
 * lib/services/pdtp-adapters/occurrence-gap-connector.ts
 *
 * N°57 — "Comunicación Efectiva". Plazo 30 días.
 *
 * El hecho que la hace exigible es la **ocurrencia incumplida**: llegó el plazo
 * de la posición del cronograma y la actividad sigue sin hacerse, o alguien la
 * declaró explícitamente no hecha. No es programarla: si el reloj partiera al
 * programarla, el plazo lo elegiría la misma persona que después responde por
 * cumplirlo, y el indicador de oportunidad sería trivial de aprobar. El
 * incumplimiento, en cambio, aparece solo.
 *
 * **Una obligación por ocurrencia** —ítem del catálogo × faena × año × slot—,
 * que es la unidad de cumplimiento desde que capacitación se mide por actividad
 * realizada y no por competencia individual. Antes era una por persona y curso;
 * ese modelo se retiró junto con las competencias por trabajador.
 *
 * No escribe el número 57 en ninguna parte: resuelve qué ítems del catálogo
 * acreditan una actividad `on_demand` medida por plazo, así que un ítem nuevo
 * que cargue una actividad de esa forma queda cubierto sin tocar este archivo.
 */

import { and, desc, eq, inArray, notInArray } from "drizzle-orm"
import { db } from "@/db"
import {
  pdtpActivities,
  pdtpProgramWorksites,
  pdtpPrograms,
  preventionTrainingCatalogItems,
  preventionTrainingOccurrences,
} from "@/db/schema"
import { PREDEFINED_TRAINING_CATALOG_VERSION } from "@/lib/prevention/training-occurrences-catalog"
import { chileDateParts } from "@/lib/utils"
import { effectiveActivationFor, isPdtpPeriodOnOrAfterActivation } from "@/lib/services/pdtp/period"
import {
  countOutcome,
  emptySweepCounters,
  ensureSubjectObligation,
  reportSubjectObligation,
  resolvePdtpProgramActorUserId,
  type ObligationSweepCounters,
} from "./obligation-kit"

const SOURCE_TYPE = "capacitacion"

export function occurrenceSubjectKey(occurrenceId: string): string {
  return `ocurrencia:${occurrenceId}`
}

/** El episodio lleva el mes de detección, por la misma razón que la N°11. */
function episodeIdFor(occurrenceId: string, occurredAt: string): string {
  const { year, month } = chileDateParts(occurredAt)
  return `${occurrenceSubjectKey(occurrenceId)}:${year}-${String(month).padStart(2, "0")}`
}

/**
 * Los números de actividad que un ítem del catálogo acredita **y** que se miden
 * por plazo de cierre a demanda — o sea, las que necesitan una obligación para
 * existir en el indicador. El resto de los ítems acredita directo y no pasa por
 * acá.
 */
export async function loadObligationBackedCatalogActivities(): Promise<Map<string, number[]>> {
  const [programs, items] = await Promise.all([
    db.select({ id: pdtpPrograms.id }).from(pdtpPrograms).where(eq(pdtpPrograms.status, "active")),
    db.select({ id: preventionTrainingCatalogItems.id, numbers: preventionTrainingCatalogItems.pdtpActivityNumbers })
      .from(preventionTrainingCatalogItems)
      .where(and(
        eq(preventionTrainingCatalogItems.isActive, true),
        eq(preventionTrainingCatalogItems.catalogVersion, PREDEFINED_TRAINING_CATALOG_VERSION),
      )),
  ])
  if (programs.length === 0 || items.length === 0) return new Map()

  const declared = new Set<number>()
  for (const item of items) for (const n of (item.numbers as number[] | null) ?? []) declared.add(n)
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

  const byItem = new Map<string, number[]>()
  for (const item of items) {
    const numbers = ((item.numbers as number[] | null) ?? []).filter((n) => obligationBacked.has(n))
    if (numbers.length > 0) byItem.set(item.id, numbers)
  }
  return byItem
}

export type OccurrenceGapSweepResult = ObligationSweepCounters & { gaps: number }

/**
 * Cuándo vence una posición del cronograma.
 *
 * El corte es **el fin del mes programado**, no el fin de la semana. La semana
 * del catálogo es una intención de planificación —"la tercera semana de mayo"—
 * y no una fecha: exigirla al día convertiría una holgura de planificación en
 * un incumplimiento, que es precisamente lo que el indicador no mide. Una
 * ocurrencia `annual` (sin mes) vence al terminar el año.
 */
function isOverdue(
  occurrence: { year: number; scheduledMonth: number | null },
  today: { year: number; month: number },
): boolean {
  if (occurrence.year < today.year) return true
  if (occurrence.year > today.year) return false
  if (occurrence.scheduledMonth === null) return false
  return occurrence.scheduledMonth < today.month
}

/**
 * ¿El programa ya le exigía esta casilla a esta faena?
 *
 * Son dos hechos y hacen falta los dos: que la versión aprobada se active —el
 * PDTP no es exigible desde el 1 de enero— y que la faena esté incorporada al
 * programa. El `cutoff` que entra acá es el más tardío de ambos, resuelto por
 * `effectiveActivationFor`. `isPdtpPeriodOnOrAfterActivation` es la regla que
 * el resto del módulo ya aplica, y la semana de corte se conserva entera porque
 * el calendario firmado sólo tiene granularidad mes/semana.
 *
 * Sin esto, un programa activado en abril abría obligación el primer día por
 * todas las casillas de febrero y marzo, y lo mismo le pasaba a una faena
 * incorporada en octubre con las casillas de todo el año anterior a su alta. Y
 * como la obligación se sella con la fecha del barrido —no con la de la
 * casilla—, caía en el mes corriente, pasaba el filtro de activación aguas
 * abajo y contaba como incumplimiento.
 *
 * La casilla NO se descarta ni se marca: sigue pendiente y se puede hacer
 * tarde, que es lo que corresponde —la actividad no se canceló, simplemente el
 * programa todavía no la exigía—. Lo único que no ocurre es el castigo.
 *
 * Una ocurrencia anual (sin mes) vence a fin de año, así que nunca es anterior
 * a la activación dentro del mismo año.
 */
function isDemandedByProgram(
  occurrence: { year: number; scheduledMonth: number | null; scheduledWeek: number | null },
  cutoff: string | null | undefined,
): boolean {
  if (!cutoff) return true
  if (occurrence.scheduledMonth === null || occurrence.scheduledWeek === null) return true
  return isPdtpPeriodOnOrAfterActivation(
    { year: occurrence.year, month: occurrence.scheduledMonth, week: occurrence.scheduledWeek },
    cutoff,
  )
}

/**
 * Barrido diario.
 *
 * Abre por dos hechos distintos: la ocurrencia declarada `not_completed` —que
 * es una afirmación explícita de incumplimiento y no necesita esperar plazo— y
 * la que sigue `pending` después de vencido su mes.
 */
export async function sweepTrainingOccurrenceObligations(): Promise<OccurrenceGapSweepResult> {
  const counters = emptySweepCounters()
  const byItem = await loadObligationBackedCatalogActivities()
  if (byItem.size === 0) return { ...counters, gaps: 0 }

  const occurredAt = new Date().toISOString()
  const today = chileDateParts(occurredAt)

  /* El programa se resuelve antes de filtrar y no después, porque su semana de
   * activación decide qué casillas exige: el PDTP se vuelve exigible al
   * activarse la versión aprobada, no el 1 de enero. Acá también se lee el
   * actor, que antes era el único motivo de esta consulta.
   *
   * El barrido puede coexistir con programas activos de otros años; elegir el
   * primer activo sin filtrar por año y versión dejaba obligaciones del año
   * corriente atribuidas al autor de una versión histórica. */
  const [program] = await db.select({ id: pdtpPrograms.id, activatedAt: pdtpPrograms.activatedAt })
    .from(pdtpPrograms)
    .where(and(eq(pdtpPrograms.status, "active"), eq(pdtpPrograms.year, today.year)))
    .orderBy(desc(pdtpPrograms.version))
    .limit(1)

  const candidates = await db.select({
    id: preventionTrainingOccurrences.id,
    catalogItemId: preventionTrainingOccurrences.catalogItemId,
    worksiteId: preventionTrainingOccurrences.worksiteId,
    year: preventionTrainingOccurrences.year,
    slotKey: preventionTrainingOccurrences.slotKey,
    scheduledMonth: preventionTrainingOccurrences.scheduledMonth,
    scheduledWeek: preventionTrainingOccurrences.scheduledWeek,
    status: preventionTrainingOccurrences.status,
  })
    .from(preventionTrainingOccurrences)
    .where(and(
      inArray(preventionTrainingOccurrences.catalogItemId, [...byItem.keys()]),
      /* `not_applicable` se excluye acá y no al filtrar más abajo: una casilla
       * declarada no aplicable vence igual que cualquier otra, así que
       * `isOverdue` la marcaría como brecha y el programa abriría un compromiso
       * sobre algo que alguien ya declaró que no corresponde. Es la razón por
       * la que el estado existe. */
      notInArray(preventionTrainingOccurrences.status, ["completed", "not_applicable"]),
    ))

  /* El corte es por faena, no sólo por programa: una faena incorporada en
   * octubre tampoco debe recibir obligaciones por las casillas de marzo. Es la
   * misma razón por la que el programa recién activado no las abre, un nivel
   * más abajo. Se resuelve de una consulta para todas las faenas candidatas en
   * vez de una por ocurrencia. */
  const addedAtByWorksite = new Map<string, string>()
  if (program) {
    const memberships = await db.select({
      worksiteId: pdtpProgramWorksites.worksiteId,
      addedAt: pdtpProgramWorksites.addedAt,
    }).from(pdtpProgramWorksites).where(eq(pdtpProgramWorksites.programId, program.id))
    for (const row of memberships) addedAtByWorksite.set(row.worksiteId, row.addedAt)
  }

  const gaps = candidates.filter((occurrence) => {
    const cutoff = effectiveActivationFor(
      program?.activatedAt,
      addedAtByWorksite.get(occurrence.worksiteId),
    )
    if (!isDemandedByProgram(occurrence, cutoff)) return false
    return occurrence.status === "not_completed" || isOverdue(occurrence, today)
  })
  if (gaps.length === 0) return { ...counters, gaps: 0 }

  const actorUserId = program ? await resolvePdtpProgramActorUserId(program.id) : null

  for (const occurrence of gaps) {
    for (const activityNumber of byItem.get(occurrence.catalogItemId) ?? []) {
      const outcome = await ensureSubjectObligation({
        activityNumber,
        worksiteId: occurrence.worksiteId,
        subjectKey: occurrenceSubjectKey(occurrence.id),
        sourceType: SOURCE_TYPE,
        sourceId: episodeIdFor(occurrence.id, occurredAt),
        occurredAt,
        userId: actorUserId,
        sourceMetadata: {
          occurrenceId: occurrence.id,
          catalogItemId: occurrence.catalogItemId,
          year: occurrence.year,
          slotKey: occurrence.slotKey,
          occurrenceStatus: occurrence.status,
        },
      })
      countOutcome(counters, outcome)
    }
  }

  return { ...counters, gaps: gaps.length }
}

/**
 * La ocurrencia se marcó hecha: reporta su obligación.
 *
 * Tolerante a que no haya ninguna abierta —el barrido puede no haber corrido
 * todavía, o la actividad puede haberse hecho dentro de plazo—: eso lo resuelve
 * `reportSubjectObligation`, que advierte y sigue.
 */
export async function onTrainingOccurrenceCompleted(input: {
  occurrenceId: string
  catalogItemId: string
  worksiteId: string
  completedAt: string
  userId: string
}): Promise<void> {
  const numbers = (await loadObligationBackedCatalogActivities()).get(input.catalogItemId) ?? []
  if (numbers.length === 0) return

  for (const activityNumber of numbers) {
    await reportSubjectObligation({
      activityNumber,
      worksiteId: input.worksiteId,
      subjectKey: occurrenceSubjectKey(input.occurrenceId),
      occurredAt: input.completedAt,
      evidenceText: `Actividad de capacitación registrada como hecha: ${input.occurrenceId}`,
      userId: input.userId,
    })
  }
}
