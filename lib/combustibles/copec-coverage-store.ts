import { and, eq, gte, lte, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelProviderFiles, fuelProviderPeriodCoverage } from "@/db/schema"
import { nanoid } from "@/lib/id"
import type { CopecCoverageChannel, CopecCoverageProduct, CopecCoverageStatus } from "./copec-coverage"

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
    updatedAt: fuelProviderPeriodCoverage.updatedAt,
  }).from(fuelProviderPeriodCoverage).where(and(
    eq(fuelProviderPeriodCoverage.provider, "copec"),
    gte(fuelProviderPeriodCoverage.periodMonth, `${from.slice(0, 7)}-01`),
    lte(fuelProviderPeriodCoverage.periodMonth, `${to.slice(0, 7)}-01`),
  ))
}

export async function recordCopecPeriodCoverage(observation: CopecCoverageObservation) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(observation.month)) throw new Error("El mes de cobertura debe ser el primer día del mes")
  if (observation.status === "legitimate_empty" && (
    observation.sourceAvailability !== "available" || !observation.evidence?.trim() || !observation.evidenceActorUserId
  )) throw new Error("Un período legítimamente vacío requiere evidencia y operador responsable")

  const now = new Date().toISOString()
  // A later query that returns no file is not evidence that a previously
  // verified period lost its data. Preserve the whole verified observation,
  // not just its terminal status, so the source file and totals remain auditable.
  // A failed download (`failed` with unknown availability: network, session,
  // selector) says nothing about the data either. Only a file that was actually
  // received and rejected may reopen a verified month.
  const preserveClosedCoverage = sql`
    ${fuelProviderPeriodCoverage.status} IN ('complete', 'legitimate_empty')
    AND (
      ${observation.status} IN ('unknown', 'legitimate_empty')
      OR (${observation.status} = 'failed' AND ${observation.sourceAvailability} = 'unknown')
    )
  `
  await db.insert(fuelProviderPeriodCoverage).values({
    id: nanoid(),
    provider: "copec",
    sourceAccount: accountFor(observation.channel, observation.product),
    channel: observation.channel,
    product: observation.product,
    periodMonth: observation.month,
    status: observation.status,
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
    evidence: observation.evidence ?? null,
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
      status: sql`CASE WHEN ${preserveClosedCoverage} THEN ${fuelProviderPeriodCoverage.status} ELSE ${observation.status} END`,
      sourceAvailability: sql`CASE WHEN ${preserveClosedCoverage} THEN ${fuelProviderPeriodCoverage.sourceAvailability} ELSE ${observation.sourceAvailability} END`,
      syncRunId: sql`CASE WHEN ${preserveClosedCoverage} THEN ${fuelProviderPeriodCoverage.syncRunId} ELSE ${observation.syncRunId ?? null} END`,
      sourceFileId: sql`CASE WHEN ${preserveClosedCoverage} THEN ${fuelProviderPeriodCoverage.sourceFileId} ELSE ${observation.sourceFileId ?? null} END`,
      rowsReceived: sql`CASE WHEN ${preserveClosedCoverage} THEN ${fuelProviderPeriodCoverage.rowsReceived} ELSE ${observation.rowsReceived ?? 0} END`,
      rowsAccepted: sql`CASE WHEN ${preserveClosedCoverage} THEN ${fuelProviderPeriodCoverage.rowsAccepted} ELSE ${observation.rowsAccepted ?? 0} END`,
      rowsRejected: sql`CASE WHEN ${preserveClosedCoverage} THEN ${fuelProviderPeriodCoverage.rowsRejected} ELSE ${observation.rowsRejected ?? 0} END`,
      rowsPending: sql`CASE WHEN ${preserveClosedCoverage} THEN ${fuelProviderPeriodCoverage.rowsPending} ELSE ${observation.rowsPending ?? 0} END`,
      quantityTotal: sql`CASE WHEN ${preserveClosedCoverage} THEN ${fuelProviderPeriodCoverage.quantityTotal} ELSE ${observation.quantityTotal ?? 0} END`,
      amountTotal: sql`CASE WHEN ${preserveClosedCoverage} THEN ${fuelProviderPeriodCoverage.amountTotal} ELSE ${observation.amountTotal ?? 0} END`,
      parserVersion: sql`CASE WHEN ${preserveClosedCoverage} THEN ${fuelProviderPeriodCoverage.parserVersion} ELSE ${observation.parserVersion ?? null} END`,
      evidence: sql`CASE WHEN ${preserveClosedCoverage} THEN ${fuelProviderPeriodCoverage.evidence} ELSE ${observation.evidence ?? null} END`,
      evidenceActorUserId: sql`CASE WHEN ${preserveClosedCoverage} THEN ${fuelProviderPeriodCoverage.evidenceActorUserId} ELSE ${observation.evidenceActorUserId ?? null} END`,
      updatedAt: sql`CASE WHEN ${preserveClosedCoverage} THEN ${fuelProviderPeriodCoverage.updatedAt} ELSE ${now} END`,
    },
  })
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
