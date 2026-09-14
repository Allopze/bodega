/**
 * lib/services/pdtp-adapters/worker-lifecycle-connector.ts
 *
 * N°15 (inducción IRL) y N°52 (habilitación del trabajador nuevo). Las dos con
 * plazo cero: el catálogo dice "antes que ingrese la persona trabajadora".
 *
 * El hecho que las hace exigibles es que **alguien entre a la dotación de una
 * faena**, y eso ocurre por cuatro caminos distintos —alta manual, importación
 * masiva, reactivación y traslado— que hasta ahora no compartían nada. Por eso
 * primero se extrajo `lib/services/workers.ts`: sin un lugar donde el hecho
 * exista, este conector tendría que adivinarlo cuatro veces.
 *
 * Las dos cierran con el acta de trabajador nuevo
 * (`worker-onboarding-connector.ts`).
 *
 * Este conector **sólo abre**. Nunca lanza: cuando corre, la escritura sobre la
 * dotación ya está confirmada y un problema del PDTP no puede deshacerla.
 */

import type { WorkerLifecycleEvent } from "@/lib/services/workers"
import { resolvePdtpActivityIdsForNumbers } from "@/lib/services/pdtp/accreditation"
import { resolvePdtpEffectiveActivitiesForWorksite } from "@/lib/services/pdtp/worksites"
import {
  countOutcome,
  emptySweepCounters,
  ensureSubjectObligation,
  resolvePdtpProgramActorUserId,
  type ObligationSweepCounters,
} from "./obligation-kit"

/**
 * Las que abre la entrada de una persona a la dotación.
 *
 * La **N°16** (prueba de evaluación de la inducción IRL) es de esta misma
 * familia y entra acá en cuanto exista el curso que la cierra: hoy ninguna fila
 * de `prevention_training_courses` la declara, así que abrirle un compromiso
 * sería fabricar casos que nadie puede cerrar y que vencerían para siempre. Una
 * obligación sin cierre posible no mide, sólo acusa.
 */
const WORKER_ENTRY_ACTIVITY_NUMBERS = [15, 52] as const

const SOURCE_TYPE = "trabajador"

export function workerSubjectKey(workerId: string): string {
  return `worker:${workerId}`
}

/**
 * El episodio distingue una entrada de la siguiente.
 *
 * El alta no lleva fecha: una persona se da de alta una sola vez, y guardar dos
 * veces el mismo formulario tiene que ser un no-op. El traslado y la
 * reactivación sí la llevan, porque son repetibles: quien vuelve en marzo y
 * otra vez en agosto entró dos veces, y son dos compromisos distintos.
 */
function episodeIdFor(event: WorkerLifecycleEvent): string {
  const base = workerSubjectKey(event.workerId)
  if (event.kind === "alta") return `${base}:alta`
  return `${base}:${event.kind}:${event.occurredAt.slice(0, 10)}`
}

export type WorkerEntryResult = ObligationSweepCounters & { events: number }

/**
 * Abre las obligaciones de entrada de una tanda de eventos.
 *
 * Resuelve las actividades efectivas **una vez por faena**: la importación
 * masiva puede traer cientos de eventos repartidos en un puñado de faenas, y
 * consultar exclusiones por evento sería un N+1 con N grande.
 */
/** Los tres hechos que incorporan a alguien a la dotación de una faena. */
const ENTRY_KINDS = new Set<WorkerLifecycleEvent["kind"]>(["alta", "traslado", "reactivacion"])

export async function onWorkerEnteredDotacion(
  allEvents: readonly WorkerLifecycleEvent[],
  userId: string | null,
): Promise<WorkerEntryResult> {
  const counters = emptySweepCounters()
  /**
   * E2E-007: desde que la baja también es un evento del ciclo, este conector
   * tiene que decir explícitamente cuáles le competen. Abrir las obligaciones
   * de incorporación para quien se va sería exactamente al revés.
   */
  const events = allEvents.filter((event) => ENTRY_KINDS.has(event.kind))
  if (events.length === 0) return { ...counters, events: 0 }

  const effectiveByWorksite = new Map<string, Set<string>>()
  let actorUserId = userId
  let actorResolved = userId !== null

  for (const event of events) {
    for (const activityNumber of WORKER_ENTRY_ACTIVITY_NUMBERS) {
      let effective = effectiveByWorksite.get(event.worksiteId)
      if (!effective) {
        const resolved = await resolvePdtpActivityIdsForNumbers({
          worksiteId: event.worksiteId,
          occurredAt: event.occurredAt,
          activityNumbers: [...WORKER_ENTRY_ACTIVITY_NUMBERS],
          sourceType: SOURCE_TYPE,
          sourceId: episodeIdFor(event),
        }).catch(() => null)
        if (!resolved) {
          // Sin programa activo para esta faena: no hay nada que abrir y no es
          // un error. Se cuenta como omitida una vez por actividad.
          countOutcome(counters, "skipped_no_program")
          continue
        }
        if (!actorResolved) {
          actorUserId = await resolvePdtpProgramActorUserId(resolved.programId)
          actorResolved = true
        }
        effective = new Set((await resolvePdtpEffectiveActivitiesForWorksite(resolved.programId, event.worksiteId)).map((a) => a.id))
        effectiveByWorksite.set(event.worksiteId, effective)
      }

      const outcome = await ensureSubjectObligation({
        activityNumber,
        worksiteId: event.worksiteId,
        subjectKey: workerSubjectKey(event.workerId),
        sourceType: SOURCE_TYPE,
        sourceId: episodeIdFor(event),
        occurredAt: event.occurredAt,
        userId: actorUserId,
        sourceMetadata: {
          workerId: event.workerId,
          entryKind: event.kind,
          ...(event.previousWorksiteId ? { previousWorksiteId: event.previousWorksiteId } : {}),
        },
        effectiveActivityIds: effective,
      })
      countOutcome(counters, outcome)
    }
  }

  return { ...counters, events: events.length }
}
