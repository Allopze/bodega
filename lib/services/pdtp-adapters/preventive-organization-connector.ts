/**
 * lib/services/pdtp-adapters/preventive-organization-connector.ts
 *
 * N°11 — "Constituir el o los Comités Paritarios cuando proceda y verificar su
 * funcionamiento". Plazo 30 días.
 *
 * El hecho que la hace exigible es que **la faena alcance la dotación que
 * obliga a tener un órgano preventivo**. Eso no es un evento que alguien
 * dispare: es una condición que aparece cuando entra gente, y que también
 * aparece **sin ninguna escritura sobre `workers`** cuando el mandato del
 * comité vence. Por eso el observador es un barrido, no un gancho en el alta de
 * trabajadores:
 *
 * - un gancho ve sólo escrituras futuras, y las faenas que ya cruzaron el
 *   umbral lo hicieron antes de que este código existiera;
 * - `expireLapsedCommittees` hace caer una faena en brecha sin que nadie toque
 *   la dotación;
 * - la importación masiva mueve muchas faenas en una transacción.
 *
 * El barrido igual se puede pedir para una faena concreta
 * (`evaluateWorksitePreventiveOrganization`), y eso es lo que llama el embudo
 * de trabajadores: así el cruce del umbral se detecta el mismo día en que
 * ocurre y no en el cron siguiente.
 *
 * El umbral **no se escribe acá**. Lo resuelve `assessOrganizationCompliance`
 * (`lib/prevention/cphs-organization.ts`), que es donde vive la norma: sobre 25
 * trabajadores corresponde comité; entre 10 y 25, delegado. La misma función
 * que pinta la pantalla de faenas decide qué compromiso se abre.
 */

import { and, desc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { pdtpProgramWorksites, pdtpPrograms, worksites } from "@/db/schema"
import { loadWorksiteOrganizationRows } from "@/lib/services/prevention-cphs-organization-read"
import { chileDateParts } from "@/lib/utils"
import { effectiveActivationFor } from "@/lib/services/pdtp/period"
import {
  countOutcome,
  emptySweepCounters,
  ensureSubjectObligation,
  reportSubjectObligation,
  resolvePdtpProgramActorUserId,
  type ObligationSweepCounters,
} from "./obligation-kit"
import { resolvePdtpActivityIdsForNumbers } from "@/lib/services/pdtp/accreditation"

const PREVENTIVE_ORGANIZATION_ACTIVITY_NUMBER = 11
const SOURCE_TYPE = "organizacion_preventiva"

function subjectKeyFor(worksiteId: string): string {
  return `faena:${worksiteId}`
}

/**
 * El episodio lleva el mes de detección, no sólo la faena.
 *
 * Con una clave plana el caso no podría reabrirse nunca: si el comité se
 * disuelve dentro de dos años y la brecha vuelve, `createPdtpObligation`
 * encontraría la fila vieja y devolvería `created: false`, dejando la
 * infracción nueva invisible para siempre. Con el mes, y con el guard de
 * "ya hay una abierta" de `ensureSubjectObligation`, queda exactamente un caso
 * vivo por faena: sigue abierto y vence mientras la brecha dure, y sólo puede
 * nacer uno nuevo después de que el anterior cerró.
 */
function episodeIdFor(worksiteId: string, occurredAt: string): string {
  const { year, month } = chileDateParts(occurredAt)
  return `faena:${worksiteId}:${year}-${String(month).padStart(2, "0")}`
}

export type PreventiveOrganizationSweepResult = ObligationSweepCounters & { evaluated: number }

/**
 * ¿El programa ya le exige algo a esta faena, al día del barrido?
 *
 * Dos hechos la vuelven exigible y hacen falta los dos: que la versión aprobada
 * del programa se active y que la faena esté incorporada a él. Antes de eso la
 * brecha existe —la faena está sobre el umbral y no tiene comité— pero no es
 * incumplimiento *del programa*, y abrir el compromiso igual le cobra a una
 * faena meses en los que no estaba dentro.
 *
 * A diferencia del barrido de casillas, acá la comparación es contra **hoy** y
 * no contra una celda del cronograma: la brecha de la N°11 es una condición
 * presente —hay dotación y no hay órgano—, no una posición del calendario.
 *
 * Sin programa activo del año no se filtra nada: es el comportamiento anterior,
 * y callar todo compromiso porque no hay programa sería peor que abrirlo. Una
 * faena sin fila de membresía tampoco se filtra por faena: un programa con
 * `appliesToAllWorksites` no tiene membresías, y ahí el único corte es el suyo.
 */
async function resolveProgramDemandGate(occurredAt: string): Promise<(worksiteId: string) => boolean> {
  const { year } = chileDateParts(occurredAt)
  const [program] = await db.select({ id: pdtpPrograms.id, activatedAt: pdtpPrograms.activatedAt })
    .from(pdtpPrograms)
    .where(and(eq(pdtpPrograms.status, "active"), eq(pdtpPrograms.year, year)))
    .orderBy(desc(pdtpPrograms.version))
    .limit(1)
  if (!program) return () => true

  const memberships = await db.select({
    worksiteId: pdtpProgramWorksites.worksiteId,
    addedAt: pdtpProgramWorksites.addedAt,
  }).from(pdtpProgramWorksites).where(eq(pdtpProgramWorksites.programId, program.id))
  const addedAtByWorksite = new Map(memberships.map((row) => [row.worksiteId, row.addedAt]))

  const now = new Date(occurredAt).getTime()
  return (worksiteId: string) => {
    const cutoff = effectiveActivationFor(program.activatedAt, addedAtByWorksite.get(worksiteId))
    if (!cutoff) return true
    const cutoffMs = new Date(cutoff).getTime()
    return Number.isNaN(cutoffMs) || cutoffMs <= now
  }
}

async function openObligationsFor(
  rows: Awaited<ReturnType<typeof loadWorksiteOrganizationRows>>,
): Promise<PreventiveOrganizationSweepResult> {
  const counters = emptySweepCounters()
  const occurredAt = new Date().toISOString()
  const isDemanded = await resolveProgramDemandGate(occurredAt)
  const gaps = rows.filter((row) => !row.compliance.compliant && isDemanded(row.worksiteId))
  if (gaps.length === 0) return { ...counters, evaluated: rows.length }

  // El actor se hereda del programa una sola vez por barrido: es el mismo para
  // todas las faenas y resolverlo por fila serían N consultas idénticas.
  let actorUserId: string | null = null
  const probe = await resolvePdtpActivityIdsForNumbers({
    worksiteId: gaps[0]!.worksiteId,
    occurredAt,
    activityNumbers: [PREVENTIVE_ORGANIZATION_ACTIVITY_NUMBER],
    sourceType: SOURCE_TYPE,
    sourceId: episodeIdFor(gaps[0]!.worksiteId, occurredAt),
  }).catch(() => null)
  if (probe) actorUserId = await resolvePdtpProgramActorUserId(probe.programId)

  for (const row of gaps) {
    const outcome = await ensureSubjectObligation({
      activityNumber: PREVENTIVE_ORGANIZATION_ACTIVITY_NUMBER,
      worksiteId: row.worksiteId,
      subjectKey: subjectKeyFor(row.worksiteId),
      sourceType: SOURCE_TYPE,
      sourceId: episodeIdFor(row.worksiteId, occurredAt),
      occurredAt,
      userId: actorUserId,
      sourceMetadata: {
        headcount: row.headcount,
        required: row.compliance.required,
        detail: row.compliance.detail,
      },
    })
    countOutcome(counters, outcome)
  }

  return { ...counters, evaluated: rows.length }
}

/**
 * Barrido diario. Se llama desde `runPreventionCphsReminders`, **después** de
 * `expireLapsedCommittees()`: primero vence lo que venció, después se evalúa la
 * brecha contra esa verdad.
 */
export async function sweepPreventiveOrganizationObligations(): Promise<PreventiveOrganizationSweepResult> {
  return openObligationsFor(await loadWorksiteOrganizationRows())
}

/**
 * La misma evaluación para las faenas que acaba de tocar una escritura de
 * dotación. Es el camino que hace que "la faena alcanzó el umbral" se note el
 * mismo día.
 */
export async function evaluateWorksitePreventiveOrganization(worksiteIds: string[]): Promise<PreventiveOrganizationSweepResult> {
  const unique = [...new Set(worksiteIds)].filter(Boolean)
  if (unique.length === 0) return { ...emptySweepCounters(), evaluated: 0 }
  return openObligationsFor(await loadWorksiteOrganizationRows(inArray(worksites.id, unique)))
}

/**
 * Cierre: constituir el comité o designar al delegado.
 *
 * **Re-evalúa el cumplimiento antes de reportar**, y ése es el punto: designar
 * un delegado en una faena de 41 personas no satisface la N°11 —la norma pide
 * comité y el delegado no lo reemplaza donde el comité es exigible—, así que no
 * puede cerrar el caso. La evidencia mínima sembrada para la actividad acepta
 * las dos vías ("acta de constitución del comité o, si no procede por dotación,
 * el registro del delegado SST"), y esta función es la que decide cuál
 * corresponde en esta faena.
 */
export async function onPreventiveOrganizationSatisfied(input: {
  worksiteId: string
  kind: "committee" | "delegate"
  entityId: string
  occurredAt: string
  userId: string
}): Promise<void> {
  const [row] = await loadWorksiteOrganizationRows(inArray(worksites.id, [input.worksiteId]))
  if (!row || !row.compliance.compliant) return

  const evidence = input.kind === "committee"
    ? `Comité Paritario constituido: ${input.entityId}`
    : `Delegado de Seguridad y Salud designado: ${input.entityId}`

  await reportSubjectObligation({
    activityNumber: PREVENTIVE_ORGANIZATION_ACTIVITY_NUMBER,
    worksiteId: input.worksiteId,
    subjectKey: subjectKeyFor(input.worksiteId),
    occurredAt: input.occurredAt,
    evidenceText: `${evidence}. ${row.compliance.detail}`,
    userId: input.userId,
  })
}
