import { and, eq, gte, lte, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelProviderFiles, fuelProviderPeriodCoverage } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import {
  CLOSED_WITH_ISSUES,
  CLOSED_WITH_ISSUES_MARKER,
  isTerminalCopecCoverage,
  type CopecCoverageChannel,
  type CopecCoverageProduct,
  type CopecCoverageStatus,
} from "./copec-coverage"

export interface CopecCoverageObservation {
  channel: CopecCoverageChannel
  product: CopecCoverageProduct
  month: string
  status: CopecCoverageStatus
  sourceAvailability: "unknown" | "available" | "unavailable"
  syncRunId?: string | null
  sourceFileId?: string | null
  rowsReceived?: number
  rowsAccepted?: number
  rowsRejected?: number
  rowsPending?: number
  quantityTotal?: number
  amountTotal?: number
  parserVersion?: string | null
  evidence?: string | null
  evidenceActorUserId?: string | null
}

function accountFor(channel: CopecCoverageChannel, product: CopecCoverageProduct) {
  return `${channel.toLowerCase()}:${product}`
}

export async function listCopecPeriodCoverage(from: string, to: string) {
  return db.select({
    provider: fuelProviderPeriodCoverage.provider,
    sourceAccount: fuelProviderPeriodCoverage.sourceAccount,
    channel: fuelProviderPeriodCoverage.channel,
    product: fuelProviderPeriodCoverage.product,
    periodMonth: fuelProviderPeriodCoverage.periodMonth,
    status: fuelProviderPeriodCoverage.status,
    sourceAvailability: fuelProviderPeriodCoverage.sourceAvailability,
    syncRunId: fuelProviderPeriodCoverage.syncRunId,
    sourceFileId: fuelProviderPeriodCoverage.sourceFileId,
    rowsReceived: fuelProviderPeriodCoverage.rowsReceived,
    rowsAccepted: fuelProviderPeriodCoverage.rowsAccepted,
    rowsRejected: fuelProviderPeriodCoverage.rowsRejected,
    rowsPending: fuelProviderPeriodCoverage.rowsPending,
    quantityTotal: fuelProviderPeriodCoverage.quantityTotal,
    amountTotal: fuelProviderPeriodCoverage.amountTotal,
    parserVersion: fuelProviderPeriodCoverage.parserVersion,
    evidence: fuelProviderPeriodCoverage.evidence,
    evidenceActorUserId: fuelProviderPeriodCoverage.evidenceActorUserId,
    updatedAt: fuelProviderPeriodCoverage.updatedAt,
  }).from(fuelProviderPeriodCoverage).where(and(
    eq(fuelProviderPeriodCoverage.provider, "copec"),
    gte(fuelProviderPeriodCoverage.periodMonth, `${from.slice(0, 7)}-01`),
    lte(fuelProviderPeriodCoverage.periodMonth, `${to.slice(0, 7)}-01`),
  ))
}

export async function recordCopecPeriodCoverage(observation: CopecCoverageObservation) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(observation.month)) throw new Error("El mes de cobertura debe ser el primer día del mes")
  if (!isCoverageStatusAccepted(observation.status)) {
    throw new Error(`El estado de cobertura ${observation.status} no es uno de los que reconoce el módulo`)
  }
  if ((observation.status === "legitimate_empty" || observation.status === CLOSED_WITH_ISSUES) && (
    observation.sourceAvailability !== "available" || !observation.evidence?.trim() || !observation.evidenceActorUserId
  )) throw new Error("Cerrar un período con evidencia (vacío o con observaciones) requiere el motivo y el operador responsable")

  const now = new Date().toISOString()
  // A later query that returns no file is not evidence that a previously
  // verified period lost its data. Preserve the whole verified observation,
  // not just its terminal status, so the source file and totals remain auditable.
  // A failed download (`failed` with unknown availability: network, session,
  // selector) says nothing about the data either. Only a file that was actually
  // received and rejected may reopen a verified month.
  //
  // CO-4.5: `legitimate_empty` tampoco puede pisar un mes que SÍ trajo filas.
  // Una respuesta «no hay registros» de un producto deshabilitado llegaba
  // después de un mes `incomplete` con lotes y litros, y lo certificaba como
  // vacío para siempre. Cualquier observación con datos gana sobre el vacío.
  const preserveClosedCoverage = sql`
    (
      ${fuelProviderPeriodCoverage.status} IN ('complete', 'legitimate_empty', ${CLOSED_WITH_ISSUES})
      AND (
        ${observation.status} IN ('unknown', 'legitimate_empty')
        OR (${observation.status} = 'failed' AND ${observation.sourceAvailability} = 'unknown')
      )
    )
    OR (
      ${observation.status} = 'legitimate_empty'
      AND (
        ${fuelProviderPeriodCoverage.rowsReceived} > 0
        OR ${fuelProviderPeriodCoverage.rowsAccepted} > 0
        OR ${fuelProviderPeriodCoverage.quantityTotal} > 0
      )
    )
  `
  // Una observación SIN datos (`unknown`, o `failed` sin archivo: red, sesión,
  // presupuesto) cambia el estado pero no puede borrar lo que el mes ya trajo.
  // Si reescribía los contadores en 0, la secuencia `incomplete` (5 filas) →
  // `failed` por red → «no hay registros» dejaba pasar el `legitimate_empty` que
  // la regla de arriba prohíbe: certificaba vacío un mes con consumo (4.5).
  const keepCounters = sql`(
    ${preserveClosedCoverage}
    OR ${observation.status} = 'unknown'
    OR (${observation.status} = 'failed' AND ${observation.sourceAvailability} = 'unknown')
  )`
  const insert = (status: CopecCoverageStatus, evidence: string | null) => db.insert(fuelProviderPeriodCoverage).values({
    id: nanoid(),
    provider: "copec",
    sourceAccount: accountFor(observation.channel, observation.product),
    channel: observation.channel,
    product: observation.product,
    periodMonth: observation.month,
    status,
    sourceAvailability: observation.sourceAvailability,
    syncRunId: observation.syncRunId ?? null,
    sourceFileId: observation.sourceFileId ?? null,
    rowsReceived: observation.rowsReceived ?? 0,
    rowsAccepted: observation.rowsAccepted ?? 0,
    rowsRejected: observation.rowsRejected ?? 0,
    rowsPending: observation.rowsPending ?? 0,
    quantityTotal: observation.quantityTotal ?? 0,
    amountTotal: observation.amountTotal ?? 0,
    parserVersion: observation.parserVersion ?? null,
    evidence,
    evidenceActorUserId: observation.evidenceActorUserId ?? null,
    updatedAt: now,
    createdAt: now,
  }).onConflictDoUpdate({
    target: [
      fuelProviderPeriodCoverage.provider,
      fuelProviderPeriodCoverage.sourceAccount,
      fuelProviderPeriodCoverage.channel,
      fuelProviderPeriodCoverage.product,
      fuelProviderPeriodCoverage.periodMonth,
    ],
    set: {
      status: sql`CASE WHEN ${preserveClosedCoverage} THEN ${fuelProviderPeriodCoverage.status} ELSE ${status} END`,
      sourceAvailability: sql`CASE WHEN ${preserveClosedCoverage} THEN ${fuelProviderPeriodCoverage.sourceAvailability} ELSE ${observation.sourceAvailability} END`,
      syncRunId: sql`CASE WHEN ${preserveClosedCoverage} THEN ${fuelProviderPeriodCoverage.syncRunId} ELSE ${observation.syncRunId ?? null} END`,
      sourceFileId: sql`CASE WHEN ${keepCounters} THEN ${fuelProviderPeriodCoverage.sourceFileId} ELSE ${observation.sourceFileId ?? null} END`,
      rowsReceived: sql`CASE WHEN ${keepCounters} THEN ${fuelProviderPeriodCoverage.rowsReceived} ELSE ${observation.rowsReceived ?? 0} END`,
      rowsAccepted: sql`CASE WHEN ${keepCounters} THEN ${fuelProviderPeriodCoverage.rowsAccepted} ELSE ${observation.rowsAccepted ?? 0} END`,
      rowsRejected: sql`CASE WHEN ${keepCounters} THEN ${fuelProviderPeriodCoverage.rowsRejected} ELSE ${observation.rowsRejected ?? 0} END`,
      rowsPending: sql`CASE WHEN ${keepCounters} THEN ${fuelProviderPeriodCoverage.rowsPending} ELSE ${observation.rowsPending ?? 0} END`,
      quantityTotal: sql`CASE WHEN ${keepCounters} THEN ${fuelProviderPeriodCoverage.quantityTotal} ELSE ${observation.quantityTotal ?? 0} END`,
      amountTotal: sql`CASE WHEN ${keepCounters} THEN ${fuelProviderPeriodCoverage.amountTotal} ELSE ${observation.amountTotal ?? 0} END`,
      parserVersion: sql`CASE WHEN ${keepCounters} THEN ${fuelProviderPeriodCoverage.parserVersion} ELSE ${observation.parserVersion ?? null} END`,
      evidence: sql`CASE WHEN ${preserveClosedCoverage} THEN ${fuelProviderPeriodCoverage.evidence} ELSE ${evidence} END`,
      evidenceActorUserId: sql`CASE WHEN ${preserveClosedCoverage} THEN ${fuelProviderPeriodCoverage.evidenceActorUserId} ELSE ${observation.evidenceActorUserId ?? null} END`,
      updatedAt: sql`CASE WHEN ${preserveClosedCoverage} THEN ${fuelProviderPeriodCoverage.updatedAt} ELSE ${now} END`,
    },
  })

  try {
    await insert(observation.status, observation.evidence ?? null)
  } catch (error) {
    // El valor `closed_with_issues` necesita que el CHECK del esquema lo acepte
    // (migración del carril E). Mientras no esté, el mes NO se puede quedar sin
    // cerrar: se guarda como `complete`, con la marca y el motivo en la
    // evidencia, y `copecCoverageStatusOf` lo vuelve a leer como «cerrado con
    // observaciones». En cuanto la migración exista, este camino no se usa.
    if (observation.status !== CLOSED_WITH_ISSUES || !isCoverageStatusConstraintViolation(error)) throw error
    const reason = (observation.evidence ?? "").trim()
    console.warn("[copec-coverage] el esquema no admite el estado closed_with_issues; se guarda como complete con la marca de evidencia")
    await insert("complete", `${CLOSED_WITH_ISSUES_MARKER} ${reason}`.trim())
  }
}

/** Los estados que el dominio reconoce (el CHECK de la tabla es más corto hasta la migración). */
function isCoverageStatusAccepted(status: string): boolean {
  return status === "unknown" || status === "incomplete" || status === "failed" || status === "complete" || status === "legitimate_empty" || status === CLOSED_WITH_ISSUES
}

function isCoverageStatusConstraintViolation(error: unknown): boolean {
  const pgError = error as { code?: unknown; constraint?: unknown; constraint_name?: unknown; message?: unknown } | null
  if (!pgError || pgError.code !== "23514") return false
  const constraint = String(pgError.constraint ?? pgError.constraint_name ?? "")
  return constraint === "fuel_provider_coverage_status_valid" || /fuel_provider_coverage_status_valid/.test(String(pgError.message ?? ""))
}

export interface CopecCloseWithIssuesInput {
  channel: CopecCoverageChannel
  product: CopecCoverageProduct
  /** Primer día del mes (`YYYY-MM-01`). */
  month: string
  /** Motivo escrito por la persona que cierra: obligatorio (decisión E6). */
  reason: string
  actorUserId: string
  actorEmail?: string | null
}

/**
 * Cierra un canal/producto/mes como `closed_with_issues` y lo audita.
 *
 * El llamador (la acción de la pantalla de Fuentes) ya validó con
 * `canCloseCopecPeriodWithIssues`; acá se vuelve a comprobar sobre la fila
 * guardada porque entre la pantalla y el envío la corrida pudo cambiar la
 * cobertura. Los contadores se conservan: el cierre no reescribe lo que trajo
 * Copec, sólo decide que la revisión terminó.
 */
export async function closeCopecPeriodWithIssues(input: CopecCloseWithIssuesInput): Promise<{ status: CopecCoverageStatus; evidence: string }> {
  const [current] = await db.select().from(fuelProviderPeriodCoverage).where(and(
    eq(fuelProviderPeriodCoverage.provider, "copec"),
    eq(fuelProviderPeriodCoverage.sourceAccount, accountFor(input.channel, input.product)),
    eq(fuelProviderPeriodCoverage.periodMonth, input.month),
  )).limit(1)
  if (!current) throw new Error("No hay ninguna observación de cobertura para ese canal y producto")
  if (isTerminalCopecCoverage(current.status)) throw new Error("Ese canal y producto ya tiene la cobertura cerrada")
  if (current.rowsPending > 0) throw new Error("Quedan filas sin asignar a un equipo o faena: resuélvelas antes de cerrar el mes")
  if (current.sourceAvailability !== "available" || current.rowsReceived === 0) {
    throw new Error("Copec no entregó filas para ese mes: usa «confirmar vacío» o vuelve a sincronizar")
  }

  const earlier = (current.evidence ?? "").trim()
  const evidence = [
    CLOSED_WITH_ISSUES_MARKER,
    input.reason.trim(),
    `${current.rowsAccepted} aceptadas, ${current.rowsRejected} rechazadas de ${current.rowsReceived} filas.`,
    earlier ? `Observación previa: ${earlier}` : null,
  ].filter(Boolean).join(" ")

  await recordCopecPeriodCoverage({
    channel: input.channel,
    product: input.product,
    month: input.month,
    status: CLOSED_WITH_ISSUES,
    sourceAvailability: "available",
    syncRunId: current.syncRunId,
    sourceFileId: current.sourceFileId,
    rowsReceived: current.rowsReceived,
    rowsAccepted: current.rowsAccepted,
    rowsRejected: current.rowsRejected,
    rowsPending: current.rowsPending,
    quantityTotal: current.quantityTotal,
    amountTotal: current.amountTotal,
    parserVersion: current.parserVersion,
    evidence,
    evidenceActorUserId: input.actorUserId,
  })

  await recordAudit({
    userId: input.actorUserId,
    userEmail: input.actorEmail ?? undefined,
    action: "close",
    entityType: "fuel_provider_period_coverage",
    entityId: current.id,
    entityCode: `${input.channel} ${input.product} ${input.month.slice(0, 7)}`,
    oldState: { status: current.status, rowsReceived: current.rowsReceived, rowsAccepted: current.rowsAccepted, rowsRejected: current.rowsRejected },
    newState: { status: CLOSED_WITH_ISSUES, evidence },
    reason: input.reason.trim(),
  })

  return { status: CLOSED_WITH_ISSUES, evidence }
}

export async function recordCopecFile(input: typeof fuelProviderFiles.$inferInsert) {
  await db.insert(fuelProviderFiles).values(input).onConflictDoNothing()
}

export async function updateCopecFileParseResult(input: {
  id: string
  status: "processed" | "invalid"
  rowsReceived: number
  rowsAccepted: number
  rowsRejected: number
  rowsPending?: number
  quantityTotal: number
  amountTotal: number
}) {
  await db.update(fuelProviderFiles).set({
    status: input.status,
    rowsReceived: input.rowsReceived,
    rowsAccepted: input.rowsAccepted,
    rowsRejected: input.rowsRejected,
    ...(input.rowsPending === undefined ? {} : { rowsPending: input.rowsPending }),
    quantityTotal: input.quantityTotal,
    amountTotal: input.amountTotal,
  }).where(eq(fuelProviderFiles.id, input.id))
}
