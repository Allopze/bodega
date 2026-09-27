/**
 * lib/services/pdtp/period-closures.ts
 *
 * Cierre mensual del Programa de Trabajo Preventivo por faena (Fase 4, G4).
 *
 * ## Qué es un cierre
 *
 * Un cierre congela **una foto** (`snapshotJson`) de cómo se veía el mes de
 * una faena en el momento en que alguien lo dio por terminado: el documento
 * RE-36 completo, los indicadores de cumplimiento, el índice integral, el
 * reporte de gestión acumulado hasta ese mes, los desvíos declarados y el
 * avance por objetivo. Esa foto es el producto, no una caché: el export del
 * cierre (`app/api/prevencion/pdtp/cierres/[closureId]/export/route.ts`)
 * renderiza **desde el JSON**, sin volver a consultar la base. Meses después,
 * con el programa ya modificado, la descarga sigue produciendo exactamente el
 * Excel que se firmó.
 *
 * ## Qué bloquea
 *
 * Mientras el mes está `closed`, ninguna escritura manual sobre celdas de ese
 * mes/faena pasa: `assertPdtpPeriodOpen` se invoca **dentro de la transacción**
 * de cada escritura (`markPdtpExecution`, `approvePdtpExecution`,
 * `rejectPdtpExecution`, `recordPdtpDeviation`, `withdrawPdtpDeviation`,
 * `setPdtpActivityOverride`), no antes y por fuera — mismo criterio que la
 * exclusión mutua celda-desvío: una comprobación fuera de la transacción es
 * una lectura obsoleta en cuanto otra transacción cierra el mes.
 *
 * Un desvío `reprogrammed` toca **dos** celdas (origen y destino), así que se
 * comprueban los dos meses: si el destino está cerrado, mover planificado
 * hacia allá alteraría un mes ya congelado.
 *
 * ## Qué NO bloquea, y por qué existe `driftedSinceClose`
 *
 * La acreditación por integración (`accreditPdtpFromEvent`) **no** se bloquea.
 * Un hecho operacional que ocurre en otro módulo —una inspección, una entrega
 * de EPP, un cierre de indicadores— no puede fallar porque alguien cerró un
 * mes en Prevención: el evento es real y perderlo sería peor que aceptarlo
 * tarde. La consecuencia es que la base viva puede separarse de la foto, y eso
 * se dice en voz alta en vez de esconderse: `getPdtpPeriodClosure` recalcula
 * el snapshot y compara digests (`driftedSinceClose`). Se muestra sólo en el
 * detalle del cierre, donde hay espacio para explicarlo.
 *
 * ## Qué no toca
 *
 * Los cierres **no** entran en la huella firmada del programa
 * (`content-digest.ts`): son operación posterior a la firma, igual que los
 * overrides de meta y los desvíos.
 */

import { createHash } from "node:crypto"
import { and, desc, eq, sql } from "drizzle-orm"
import { db, type DB, type Tx } from "@/db"
import {
  pdtpActivities,
  pdtpExecutionDeviations,
  pdtpExecutions,
  pdtpPeriodClosures,
  pdtpPrograms,
  users,
  worksites,
  type PdtpPeriodClosure,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { closePdtpPeriodSchema, reopenPdtpPeriodSchema } from "@/lib/validation/prevention"
import {
  addPdtpChangeLogEntry,
  assertWorksiteAccess,
  isActivePdtpWorksite,
  type WorksiteScope,
} from "./helpers"
import { assertPdtpWorksiteCanOperateProgram } from "./worksites"
import { assertPdtpProgramAcceptsPeriod } from "./version-window"
import { buildPdtpRe36Document, type PdtpRe36Document, type PdtpRe36DeviationRow } from "./re36-document"
import { getPdtpComplianceWithIntegral, cutPdtpComplianceIndicatorsToMonth, pdtpCountedExecuted, type PdtpComplianceIndicators, type PdtpIntegralCompliance } from "./compliance"
import { getPdtpManagementReport, type PdtpManagementReport } from "./management-report"
import { currentPdtpPeriod, pdtpActivationPeriod } from "./period"
import { pdtpMonthLabel as monthLabel } from "./period-guard"
import { enqueueGeneratedDocumentTx } from "@/lib/services/generated-documents/enqueue"
import { countPendingPdtpScheduledOutcomesForMonth } from "./scheduled-outcome-review"

/* ── Corte reproducible ──────────────────────────────────────────────────── */

const CHILE_OFFSET_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Santiago",
  timeZoneName: "longOffset",
})

/** Desfase de Chile respecto de UTC, en milisegundos, en un instante dado. */
function chileOffsetMs(at: Date): number {
  const label = CHILE_OFFSET_FORMAT.formatToParts(at).find((part) => part.type === "timeZoneName")?.value ?? ""
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(label)
  // Chile no ha estado nunca fuera de UTC-3/UTC-4; el respaldo sólo evita un
  // NaN si el runtime no soporta `longOffset`.
  if (!match) return -4 * 60 * 60 * 1000
  const sign = match[1] === "-" ? -1 : 1
  return sign * ((Number(match[2]) * 60 + Number(match[3])) * 60 * 1000)
}

/**
 * Último instante del mes, en hora de Chile, como ISO.
 *
 * El corte del cierre **tiene que ser determinista**: `driftedSinceClose`
 * recalcula el snapshot y compara digests, así que si el `asOf` fuera "ahora"
 * el digest cambiaría en cada recálculo y todo cierre aparecería desviado
 * desde el primer segundo. Por eso el corte se deriva del período, no del
 * reloj — y se mide en hora de Chile, que es la que usa la faena: un corte en
 * UTC dejaría fuera del mes lo registrado entre las 21:00 y la medianoche del
 * último día.
 *
 * Dos pasadas para resolver el desfase: la primera aproxima el instante con el
 * desfase vigente a la medianoche UTC, la segunda lo corrige con el desfase
 * vigente en el instante aproximado (relevante sólo si el cambio de hora cae
 * justo ahí).
 */
export function pdtpPeriodCutoffIso(year: number, month: number): string {
  const nextYear = month === 12 ? year + 1 : year
  const nextMonthIndex = month === 12 ? 0 : month
  const nextMonthUtc = Date.UTC(nextYear, nextMonthIndex, 1)
  const firstGuess = nextMonthUtc - chileOffsetMs(new Date(nextMonthUtc))
  const startOfNextMonth = nextMonthUtc - chileOffsetMs(new Date(firstGuess))
  return new Date(startOfNextMonth - 1).toISOString()
}

/* ── Identidad y digest ──────────────────────────────────────────────────── */

/**
 * Id determinista del cierre. No usa `nanoid()` a propósito: el cierre de un
 * mes es único por (programa, faena, año, mes) y el `ON CONFLICT` que
 * incrementa la versión necesita poder nombrar la fila sin leerla antes.
 */
export function pdtpPeriodClosureId(programId: string, worksiteId: string, year: number, month: number): string {
  return `pdtp-close-${programId}-${worksiteId}-${year}-${String(month).padStart(2, "0")}`
}

/** JSON canónico: claves ordenadas en todos los niveles, para que dos objetos
 * equivalentes produzcan siempre el mismo texto y, con él, el mismo digest. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`
}

/**
 * Digest de la foto: sha256 del JSON canónico, **menos el control de cambios**.
 *
 * `re36.changeControl` es una bitácora que crece sola — y el propio cierre
 * escribe una entrada en ella (`closure:AAAA-MM`). Si entrara en el digest,
 * recalcular la foto un segundo después de cerrarla ya daría un hash distinto
 * y **todo cierre nacería desviado**, dejando `driftedSinceClose` sin ningún
 * significado. Lo que el digest tiene que responder es "¿cambió lo medido del
 * mes?" (planificado, ejecutado, desvíos, indicadores, objetivos), no "¿alguien
 * escribió una línea de bitácora?".
 *
 * La bitácora sigue guardada dentro de `snapshotJson`, y por lo tanto en el
 * Excel del cierre: lo que se excluye es su participación en la comparación,
 * no su presencia en la foto.
 */
function digestOf(snapshot: PdtpPeriodClosureSnapshot): string {
  // `integral` tampoco entra: es una cifra corrida del año (su eje de
  // ejecución es el anual y sus ejes de verificación y cierre miran todas las
  // acciones abiertas), así que cambia con el trabajo de meses posteriores.
  // Se guarda en la foto como referencia, pero no mide "lo del mes" (W1-N02).
  const comparable = {
    ...snapshot,
    re36: { ...snapshot.re36, changeControl: null },
    integral: null,
  }
  return createHash("sha256").update(canonicalJson(comparable)).digest("hex")
}

/* ── Snapshot ────────────────────────────────────────────────────────────── */

export type PdtpPeriodClosureObjective = {
  code: string
  name: string
  planned: number
  executed: number
  /** Fracción 0-1, con el mismo techo de sobrecumplimiento del indicador. */
  percent: number | null
}

export type PdtpPeriodClosureSnapshot = {
  schemaVersion: 1
  cutoff: { year: number; month: number; asOf: string }
  re36: PdtpRe36Document
  indicators: PdtpComplianceIndicators
  integral: PdtpIntegralCompliance | null
  managementReport: PdtpManagementReport
  deviations: PdtpRe36DeviationRow[]
  objectives: PdtpPeriodClosureObjective[]
  programVersion: { version: number; contentDigest: string | null }
}

/**
 * Avance por objetivo, derivado de las filas del propio documento RE-36 en
 * vez de recalculado con una segunda consulta.
 *
 * Es deliberado: el cierre promete que su foto es coherente consigo misma, y
 * un cálculo paralelo podría discrepar del documento congelado por cualquier
 * diferencia de criterio (techo de sobrecumplimiento, filtro de vigencia,
 * modos de indicador). Las filas se deduplican por actividad porque las hojas
 * del RE-36 son subconjuntos **solapados** —la actividad 6 vive en "GENERAL" y
 * en la hoja de cargo—, y sumarlas sin deduplicar contaría dos veces lo mismo.
 * Sólo se acumulan los meses hasta el corte.
 */
export function objectivesFromRe36(document: PdtpRe36Document, cutoffMonth: number): PdtpPeriodClosureObjective[] {
  const seenActivityIds = new Set<string>()
  const totals = new Map<string, { code: string; name: string; planned: number; executed: number }>()

  for (const sheet of document.sheets) {
    for (const row of sheet.rows) {
      if (seenActivityIds.has(row.activityId)) continue
      seenActivityIds.add(row.activityId)
      const code = row.objectiveCode ?? "sin-objetivo"
      const name = row.objectiveName ?? "Sin objetivo declarado"
      const entry = totals.get(code) ?? { code, name, planned: 0, executed: 0 }
      for (let month = 1; month <= cutoffMonth; month++) {
        let monthPlanned = 0
        let monthExecuted = 0
        for (let week = 1; week <= 4; week++) {
          const cell = row.cells[(month - 1) * 4 + (week - 1)]
          if (!cell) continue
          monthPlanned += cell.p ?? 0
          monthExecuted += cell.e ?? 0
        }
        // PREV-C02: mismo tope que el indicador, por actividad y mes. Una
        // actividad sobreejecutada no cubre a otra del mismo objetivo.
        entry.planned += monthPlanned
        entry.executed += pdtpCountedExecuted(monthPlanned, monthExecuted)
      }
      totals.set(code, entry)
    }
  }

  return [...totals.values()]
    .map((entry) => ({
      code: entry.code,
      name: entry.name,
      planned: entry.planned,
      executed: entry.executed,
      percent: entry.planned > 0 ? Math.round((entry.executed / entry.planned) * 100) / 100 : null,
    }))
    .sort((left, right) => left.code.localeCompare(right.code))
}

/**
 * Construye la foto del mes. Puro de escritura: no persiste nada, así que
 * sirve tanto para cerrar como para recalcular y detectar desviaciones.
 */
export async function buildPdtpPeriodClosureSnapshot(input: {
  programId: string
  worksiteId: string
  year: number
  month: number
  scope: WorksiteScope
}): Promise<PdtpPeriodClosureSnapshot> {
  assertWorksiteAccess(input.worksiteId, input.scope)

  const [program] = await db.select({
    version: pdtpPrograms.version,
    contentDigest: pdtpPrograms.contentDigest,
  }).from(pdtpPrograms).where(eq(pdtpPrograms.id, input.programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")

  const asOf = pdtpPeriodCutoffIso(input.year, input.month)

  const [re36, { indicators, integral }, managementReport] = await Promise.all([
    buildPdtpRe36Document({
      programId: input.programId,
      worksiteId: input.worksiteId,
      scope: input.scope,
      asOf,
      cutoffMonth: input.month,
    }),
    // I12: indicador e integral de un solo cálculo, mismas cifras.
    getPdtpComplianceWithIntegral(input.programId, input.worksiteId),
    getPdtpManagementReport({
      programId: input.programId,
      worksiteId: input.worksiteId,
      scope: input.scope,
      filters: { monthFrom: 1, monthTo: input.month },
    }),
  ])
  if (!indicators) throw new Error("No se pudo calcular el indicador de cumplimiento del programa para esta faena.")
  if (!managementReport) throw new Error("No se pudo calcular el reporte de gestión del programa para esta faena.")

  return {
    schemaVersion: 1,
    cutoff: { year: input.year, month: input.month, asOf },
    re36,
    // W1-N02: el indicador se congela al mes del corte. Sin recortarlo, lo
    // aprobado en un mes posterior (y `toDate` medido contra hoy) cambiaba la
    // foto y todo cierre aparecía desviado en cuanto se operaba el mes
    // siguiente.
    indicators: cutPdtpComplianceIndicatorsToMonth(indicators, input.month),
    integral,
    managementReport,
    deviations: re36.deviations,
    objectives: objectivesFromRe36(re36, input.month),
    programVersion: { version: program.version, contentDigest: program.contentDigest },
  }
}

/* ── Bloqueo de escrituras ───────────────────────────────────────────────── */

/**
 * El guard vive en `period-guard.ts` (sin las importaciones pesadas del
 * snapshot) y se reexporta acá para que quien piense en "cierres" lo encuentre
 * donde lo espera. Ver ese archivo para el porqué de la separación.
 */
export { assertPdtpPeriodOpen } from "./period-guard"

/* ── Cerrar / reabrir ────────────────────────────────────────────────────── */

async function loadClosableContext(programId: string, worksiteId: string, year: number, month: number, scope: WorksiteScope) {
  assertWorksiteAccess(worksiteId, scope)
  if (!await isActivePdtpWorksite(worksiteId)) {
    throw new Error("La faena no existe o está inactiva.")
  }

  const [program] = await db.select({
    id: pdtpPrograms.id,
    status: pdtpPrograms.status,
    year: pdtpPrograms.year,
    version: pdtpPrograms.version,
    activatedAt: pdtpPrograms.activatedAt,
  }).from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) throw new Error("Programa PDTP no encontrado.")
  if (program.year !== year) {
    throw new Error(`El cierre debe corresponder al año del programa (${program.year}).`)
  }
  // PREV-C05-B (D24): la versión vigente cierra sus meses, y una versión
  // reemplazada cierra los de su ventana. El mes pertenece a la versión que
  // era dueña de su primera semana: el mes en que se activó la sucesora lo
  // cierra la versión anterior sólo si todavía era suyo al comenzar.
  if (program.status !== "active") {
    await assertPdtpProgramAcceptsPeriod(programId, { year, month, week: 1 }, db, {
      notAcceptingMessage: "Solo se puede cerrar el mes de un programa PDTP en estado activo, o un mes propio de una versión reemplazada.",
      beforeActivationMessage: "El programa aún no estaba activo en ese mes: no hay nada que cerrar.",
    })
  }
  await assertPdtpWorksiteCanOperateProgram(programId, worksiteId)

  // No se cierra un mes que todavía no termina de ocurrir: la foto sería de un
  // mes a medias y la versión siguiente reemplazaría la que ya se distribuyó.
  // PREV-I02: el mes en curso tampoco; la comparación era `>` y lo dejaba pasar.
  const current = currentPdtpPeriod()
  if (year > current.year || (year === current.year && month > current.month)) {
    throw new Error("No se puede cerrar un mes que aún no ocurre.")
  }
  if (year === current.year && month === current.month) {
    throw new Error(`El mes de ${monthLabel(year, month)} aún no termina: solo se puede cerrar un mes ya terminado.`)
  }

  // Ni un mes anterior a la activación: ahí el programa no exigía nada, así
  // que no hay nada que congelar (y el resto del módulo ya filtra esas celdas).
  const activation = pdtpActivationPeriod(program.activatedAt)
  if (activation && (year < activation.year || (year === activation.year && month < activation.month))) {
    throw new Error("El programa aún no estaba activo en ese mes: no hay nada que cerrar.")
  }

  await assertNoPendingSubmissions(db, programId, worksiteId, year, month)
  await assertNoPendingNotApplicable(db, programId, worksiteId, year, month)

  return program
}

/**
 * PREV-C07: un "No aplica" en revisión todavía cuenta en el denominador. Si
 * el mes se congela así, aprobarlo después ya no cambia la foto —y el guard de
 * mes cerrado impide aprobarlo—. Se exige revisarlo antes, igual que los
 * envíos pendientes.
 */
async function assertNoPendingNotApplicable(client: DB | Tx, programId: string, worksiteId: string, year: number, month: number) {
  const [row] = await client.select({ pending: sql<number>`count(*)::int` })
    .from(pdtpExecutionDeviations)
    .innerJoin(pdtpActivities, eq(pdtpActivities.id, pdtpExecutionDeviations.activityId))
    .where(and(
      eq(pdtpActivities.programId, programId),
      eq(pdtpExecutionDeviations.worksiteId, worksiteId),
      eq(pdtpExecutionDeviations.year, year),
      eq(pdtpExecutionDeviations.month, month),
      eq(pdtpExecutionDeviations.status, "pending_review"),
    ))
  // PREV-C07 sobre ocurrencias (0334): un "no aplica" o una cancelación de
  // ocurrencia en revisión también cuenta todavía; mismo motivo, misma regla.
  const pending = Number(row?.pending ?? 0)
    + await countPendingPdtpScheduledOutcomesForMonth(client, { programId, worksiteId, year, month })
  if (pending > 0) {
    const label = pending === 1 ? '1 "no aplica" en revisión' : `${pending} "no aplica" en revisión`
    throw new Error(`El mes de ${monthLabel(year, month)} tiene ${label} en esta faena. Apruébalos o recházalos en Aprobaciones antes de cerrarlo.`)
  }
}

/**
 * PREV-I02: un envío `submitted` de un mes cerrado queda congelado —el guard de
 * `approvePdtpExecution`/`rejectPdtpExecution` lo rechaza— hasta que alguien
 * reabra, y la foto lo registra como no ejecutado. Antes de cerrar se exige
 * resolverlos; el mensaje dice cuántos para que se sepa qué falta.
 *
 * Corre antes del snapshot (falla rápido) y otra vez dentro de la transacción
 * del cierre, que es la lectura que vale.
 */
async function assertNoPendingSubmissions(client: DB | Tx, programId: string, worksiteId: string, year: number, month: number) {
  const [row] = await client.select({ pending: sql<number>`count(*)::int` })
    .from(pdtpExecutions)
    .innerJoin(pdtpActivities, eq(pdtpActivities.id, pdtpExecutions.activityId))
    .where(and(
      eq(pdtpActivities.programId, programId),
      eq(pdtpExecutions.worksiteId, worksiteId),
      eq(pdtpExecutions.year, year),
      eq(pdtpExecutions.month, month),
      eq(pdtpExecutions.status, "submitted"),
    ))
  const pending = Number(row?.pending ?? 0)
  if (pending > 0) {
    const label = pending === 1 ? "1 envío pendiente de aprobación" : `${pending} envíos pendientes de aprobación`
    throw new Error(`El mes de ${monthLabel(year, month)} tiene ${label} en esta faena. Apruébalos o recházalos antes de cerrarlo.`)
  }
}

/**
 * Cierra (o vuelve a cerrar) el mes de una faena. Al volver a cerrar, la foto
 * se reemplaza, `version` sube en 1 y los datos de reapertura se limpian: el
 * cierre vigente es siempre el último, y su versión es lo que distingue una
 * distribución de la siguiente (`dedupeKey`).
 *
 * El snapshot se construye **antes** de abrir la transacción: los builders
 * (`buildPdtpRe36Document`, indicadores, reporte) leen a través del `db` del
 * módulo y no aceptan un cliente de transacción. No se pierde consistencia —
 * nada se ha escrito todavía cuando se construye— y sí se gana no mantener una
 * transacción abierta durante un cálculo largo.
 */
export async function closePdtpPeriod(
  input: unknown,
  userId: string,
  scope: WorksiteScope,
): Promise<PdtpPeriodClosure> {
  const data = closePdtpPeriodSchema.parse(input)
  const program = await loadClosableContext(data.programId, data.worksiteId, data.year, data.month, scope)

  const snapshot = await buildPdtpPeriodClosureSnapshot({
    programId: data.programId,
    worksiteId: data.worksiteId,
    year: data.year,
    month: data.month,
    scope,
  })
  const digest = digestOf(snapshot)
  const now = new Date().toISOString()
  const id = pdtpPeriodClosureId(data.programId, data.worksiteId, data.year, data.month)

  return db.transaction(async (tx) => {
    await assertNoPendingSubmissions(tx, data.programId, data.worksiteId, data.year, data.month)
    await assertNoPendingNotApplicable(tx, data.programId, data.worksiteId, data.year, data.month)
    const [previous] = await tx.select({ version: pdtpPeriodClosures.version, status: pdtpPeriodClosures.status, digest: pdtpPeriodClosures.digest })
      .from(pdtpPeriodClosures).where(eq(pdtpPeriodClosures.id, id)).limit(1)

    const [closure] = await tx.insert(pdtpPeriodClosures).values({
      id,
      programId: data.programId,
      worksiteId: data.worksiteId,
      year: data.year,
      month: data.month,
      status: "closed",
      version: 1,
      snapshotJson: snapshot,
      digest,
      closedByUserId: userId,
      closedAt: now,
      closeReason: data.reason,
      distributionJson: [],
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [pdtpPeriodClosures.programId, pdtpPeriodClosures.worksiteId, pdtpPeriodClosures.year, pdtpPeriodClosures.month],
      set: {
        status: "closed",
        version: sql`${pdtpPeriodClosures.version} + 1`,
        snapshotJson: snapshot,
        digest,
        closedByUserId: userId,
        closedAt: now,
        closeReason: data.reason,
        // La reapertura anterior deja de describir el estado vigente.
        reopenedByUserId: null,
        reopenedAt: null,
        reopenReason: null,
        // Una foto nueva todavía no se distribuyó: el reenvío es una decisión
        // explícita, no algo heredado del cierre anterior.
        distributedAt: null,
        distributionJson: [],
        updatedAt: now,
      },
    }).returning()
    if (!closure) throw new Error("No se pudo cerrar el mes del programa.")

    await addPdtpChangeLogEntry(
      data.programId, program.version, userId,
      `closure:${data.year}-${String(data.month).padStart(2, "0")}`,
      previous ? { status: previous.status, version: previous.version, digest: previous.digest } : null,
      { status: "closed", version: closure.version, digest, worksiteId: data.worksiteId, reason: data.reason },
      `Mes de ${monthLabel(data.year, data.month)} cerrado (versión ${closure.version}). Motivo: ${data.reason}`,
      tx,
    )

    await recordAudit({
      userId,
      action: "close",
      entityType: "pdtp_period_closure",
      entityId: closure.id,
      entityCode: `${data.year}-${String(data.month).padStart(2, "0")}`,
      oldState: previous ? { status: previous.status, version: previous.version, digest: previous.digest } : undefined,
      newState: { status: "closed", version: closure.version, digest, worksiteId: data.worksiteId, programId: data.programId },
      reason: data.reason,
    }, tx)

    // El RE-36 congelado queda en Cloudreve con la versión de este cierre:
    // volver a cerrar el mes sobrescribe la foto, así que cada versión es su
    // propia copia.
    await enqueueGeneratedDocumentTx(tx, {
      kind: "pdtp_cierre",
      entityId: closure.id,
      milestone: "cierre",
      revision: closure.version,
      worksiteId: data.worksiteId,
      occurredAt: now,
      documentYear: data.year,
      actorUserId: userId,
    })

    return closure
  })
}

/**
 * Reabre un cierre. **Conserva el snapshot**: la foto ya se distribuyó y
 * borrarla dejaría sin respaldo lo que se envió. Lo que cambia es que el mes
 * vuelve a admitir escrituras.
 */
export async function reopenPdtpPeriod(
  input: { closureId: string; reason: string },
  userId: string,
  scope: WorksiteScope,
): Promise<PdtpPeriodClosure> {
  const data = reopenPdtpPeriodSchema.parse(input)

  return db.transaction(async (tx) => {
    const [closure] = await tx.select().from(pdtpPeriodClosures)
      .where(eq(pdtpPeriodClosures.id, data.closureId)).limit(1).for("update")
    if (!closure) throw new Error("Cierre PDTP no encontrado.")
    assertWorksiteAccess(closure.worksiteId, scope)
    if (closure.status === "reopened") throw new Error("Este mes ya está reabierto.")
    // PREV-C03.6: el cierre anual se apoya en los cierres mensuales; reabrir un
    // mes de un año cerrado le quitaría el sustento sin que nadie lo note.
    // FOR SHARE: `closePdtpProgramYear` toma las versiones del año FOR UPDATE.
    // Sin este lock la reapertura leía `yearClosedAt` nulo mientras el cierre
    // anual —que ya había contado este mes como cerrado— seguía en curso, y el
    // año quedaba cerrado sobre un mes reabierto.
    const [owner] = await tx.select({ year: pdtpPrograms.year, yearClosedAt: pdtpPrograms.yearClosedAt })
      .from(pdtpPrograms).where(eq(pdtpPrograms.id, closure.programId)).limit(1).for("share")
    if (owner?.yearClosedAt) {
      throw new Error(`El año ${owner.year} está cerrado formalmente: sus meses ya no se pueden reabrir.`)
    }

    const now = new Date().toISOString()
    const [updated] = await tx.update(pdtpPeriodClosures).set({
      status: "reopened",
      reopenedByUserId: userId,
      reopenedAt: now,
      reopenReason: data.reason,
      updatedAt: now,
    }).where(and(
      eq(pdtpPeriodClosures.id, data.closureId),
      eq(pdtpPeriodClosures.status, "closed"),
    )).returning()
    if (!updated) throw new Error("El cierre cambió de estado antes de poder reabrirse. Actualiza la página e inténtalo nuevamente.")

    const [program] = await tx.select({ version: pdtpPrograms.version })
      .from(pdtpPrograms).where(eq(pdtpPrograms.id, closure.programId)).limit(1)

    await addPdtpChangeLogEntry(
      closure.programId, program?.version ?? 1, userId,
      `closure:${closure.year}-${String(closure.month).padStart(2, "0")}`,
      { status: "closed", version: closure.version },
      { status: "reopened", reason: data.reason, worksiteId: closure.worksiteId },
      `Mes de ${monthLabel(closure.year, closure.month)} reabierto. Motivo: ${data.reason}`,
      tx,
    )

    await recordAudit({
      userId,
      action: "close",
      entityType: "pdtp_period_closure",
      entityId: closure.id,
      entityCode: `${closure.year}-${String(closure.month).padStart(2, "0")}`,
      oldState: { status: "closed", version: closure.version },
      newState: { status: "reopened", version: closure.version, worksiteId: closure.worksiteId },
      reason: data.reason,
    }, tx)

    return updated
  })
}

/* ── Lecturas ────────────────────────────────────────────────────────────── */

export type PdtpPeriodClosureListRow = PdtpPeriodClosure & { worksiteName: string; closedByName: string }

/** Cierres de un programa, más recientes primero, acotados al alcance. */
export async function listPdtpPeriodClosures(
  programId: string,
  scope: WorksiteScope,
  worksiteId?: string,
): Promise<PdtpPeriodClosureListRow[]> {
  if (scope !== "all" && scope.length === 0) return []
  if (worksiteId) assertWorksiteAccess(worksiteId, scope)

  const rows = await db.select({
    closure: pdtpPeriodClosures,
    worksiteName: worksites.name,
    closedByName: users.name,
  }).from(pdtpPeriodClosures)
    .innerJoin(worksites, eq(pdtpPeriodClosures.worksiteId, worksites.id))
    .innerJoin(users, eq(pdtpPeriodClosures.closedByUserId, users.id))
    .where(and(
      eq(pdtpPeriodClosures.programId, programId),
      worksiteId ? eq(pdtpPeriodClosures.worksiteId, worksiteId) : undefined,
    ))
    .orderBy(desc(pdtpPeriodClosures.year), desc(pdtpPeriodClosures.month), desc(pdtpPeriodClosures.updatedAt))

  return rows
    .filter((row) => scope === "all" || scope.includes(row.closure.worksiteId))
    .map(({ closure, worksiteName, closedByName }) => ({ ...closure, worksiteName, closedByName }))
}

/**
 * Detalle de un cierre, con `driftedSinceClose`: recalcula la foto del mes con
 * los datos vigentes y compara el digest. `true` significa que algo del mes
 * cambió desde el cierre — típicamente una acreditación por integración, que a
 * propósito no se bloquea. No corrige nada: avisa, para que quien lee el
 * documento congelado sepa que la base ya no dice exactamente eso.
 */
export async function getPdtpPeriodClosure(
  closureId: string,
  scope: WorksiteScope,
): Promise<(PdtpPeriodClosure & { driftedSinceClose: boolean }) | null> {
  const [closure] = await db.select().from(pdtpPeriodClosures)
    .where(eq(pdtpPeriodClosures.id, closureId)).limit(1)
  if (!closure) return null
  assertWorksiteAccess(closure.worksiteId, scope)

  let driftedSinceClose = false
  try {
    const recomputed = await buildPdtpPeriodClosureSnapshot({
      programId: closure.programId,
      worksiteId: closure.worksiteId,
      year: closure.year,
      month: closure.month,
      scope,
    })
    driftedSinceClose = digestOf(recomputed) !== closure.digest
  } catch {
    // Si la foto ya no se puede reconstruir (el programa cambió de forma, una
    // hoja desapareció), eso también es una desviación respecto de lo cerrado.
    driftedSinceClose = true
  }

  return { ...closure, driftedSinceClose }
}

/** Último cierre de un programa (para el resumen "Último cierre: MM/AAAA"). */
/**
 * D6 (plan de pendientes): qué cierres vigentes quedarían desviados con el
 * cálculo actual. Recalcula cada foto con `getPdtpPeriodClosure` —la misma
 * comparación de digest que ve la pantalla— y **no escribe nada**: está pensado
 * para correr antes de un despliegue que cambia la fórmula, con un usuario de
 * solo lectura (`scripts/report-pdtp-closure-drift.ts`).
 */
export async function reportPdtpPeriodClosureDrift(): Promise<{
  checked: number
  drifted: Array<{ closureId: string; programId: string; worksiteId: string; year: number; month: number }>
}> {
  const closures = await db.select({ id: pdtpPeriodClosures.id }).from(pdtpPeriodClosures)
    .where(eq(pdtpPeriodClosures.status, "closed"))
  const drifted: Array<{ closureId: string; programId: string; worksiteId: string; year: number; month: number }> = []
  for (const { id } of closures) {
    const closure = await getPdtpPeriodClosure(id, "all")
    if (closure?.driftedSinceClose) {
      drifted.push({ closureId: closure.id, programId: closure.programId, worksiteId: closure.worksiteId, year: closure.year, month: closure.month })
    }
  }
  return { checked: closures.length, drifted }
}

export async function getLatestPdtpPeriodClosure(
  programId: string,
  scope: WorksiteScope,
): Promise<PdtpPeriodClosureListRow | null> {
  const rows = await listPdtpPeriodClosures(programId, scope)
  return rows[0] ?? null
}
