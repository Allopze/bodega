import { createHash } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelProviderRejections,
  fuelProviderSyncRuns,
  fuelProviderTransactions,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { fuelSupplierIdForProvider } from "./fuel-sources"
import { fingerprintProviderRow, type ProviderValidationResult, type ProviderRowInput } from "./provider-validation"

/** Una consulta por proveedor y por corrida: el catálogo puede cambiar entre
 *  corridas, así que no se cachea a nivel de módulo. */
async function supplierIdsFor(providers: Iterable<"copec" | "aramco">) {
  const resolved = new Map<string, string | null>()
  for (const provider of new Set(providers)) resolved.set(provider, await fuelSupplierIdForProvider(provider))
  return resolved
}

export interface FuelProviderSyncRunInput {
  provider: "copec" | "aramco"
  trigger: "manual" | "cron" | "reprocess"
  requestedFrom: string
  requestedTo: string
  actorUserId?: string
  correlationId?: string
}

export async function beginFuelProviderSyncRun(input: FuelProviderSyncRunInput) {
  const id = nanoid()
  const correlationId = input.correlationId ?? nanoid()
  const [run] = await db.insert(fuelProviderSyncRuns).values({
    id,
    provider: input.provider,
    trigger: input.trigger,
    requestedFrom: input.requestedFrom,
    requestedTo: input.requestedTo,
    status: "running",
    correlationId,
    actorUserId: input.actorUserId,
  }).returning({ id: fuelProviderSyncRuns.id, correlationId: fuelProviderSyncRuns.correlationId })
  if (!run) throw new Error("No fue posible iniciar la corrida de combustible")
  return run
}

function jsonHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value) ?? "null", "utf8").digest("hex")
}

function rejectedIdentity(input: ProviderRowInput): string {
  return input.externalId !== null && input.externalId !== undefined && String(input.externalId).trim()
    ? `external:${String(input.externalId).trim()}`
    : `row:${input.provider}:${input.accountKey}:${input.sourceRowKey}`
}

export interface DurableProviderIssue {
  input: ProviderRowInput
  code: string
  message: string
}

async function recordRejectedItem(runId: string, item: DurableProviderIssue, status: "rejected" | "pending", supplierId: string | null) {
  const input = item.input
  const identityKey = rejectedIdentity(input)
  const quantity = typeof input.quantity === "number" && Number.isFinite(input.quantity) && input.quantity >= 0 ? input.quantity : null
  const amount = typeof input.amount === "number" && Number.isFinite(input.amount) && input.amount >= 0 ? input.amount : null
  await db.insert(fuelProviderTransactions).values({
    id: nanoid(),
    syncRunId: runId,
    provider: input.provider,
    sourceAccount: input.accountKey,
    supplierId,
    identityKey,
    externalId: input.externalId === null || input.externalId === undefined ? null : String(input.externalId),
    fingerprint: fingerprintProviderRow(input),
    sourceRowKey: input.sourceRowKey,
    sourceProduct: input.product,
    sourcePlate: input.plate,
    occurredAt: input.occurredAt,
    quantity,
    amount,
    status,
    resolutionCode: item.code,
    resolutionMessage: item.message,
    rawPayload: input.payload,
    payloadHash: jsonHash(input.payload),
    updatedAt: new Date().toISOString(),
  }).onConflictDoUpdate({
    target: [fuelProviderTransactions.provider, fuelProviderTransactions.sourceAccount, fuelProviderTransactions.identityKey],
    set: {
      syncRunId: runId,
      supplierId,
      fingerprint: fingerprintProviderRow(input),
      sourceProduct: input.product,
      sourcePlate: input.plate,
      occurredAt: input.occurredAt,
      quantity,
      amount,
      status,
      resolutionCode: item.code,
      resolutionMessage: item.message,
      rawPayload: input.payload,
      payloadHash: jsonHash(input.payload),
      updatedAt: new Date().toISOString(),
    },
  })
  await db.insert(fuelProviderRejections).values({
    id: nanoid(),
    syncRunId: runId,
    provider: input.provider,
    sourceAccount: input.accountKey,
    sourceRowKey: input.sourceRowKey,
    code: item.code,
    message: item.message,
    sourceProduct: input.product,
    sourcePlate: input.plate,
    occurredAt: input.occurredAt,
    quantity,
    amount,
    status: "open",
    rawPayload: input.payload,
  }).onConflictDoUpdate({
    target: [fuelProviderRejections.provider, fuelProviderRejections.sourceAccount, fuelProviderRejections.sourceRowKey, fuelProviderRejections.code],
    set: {
      syncRunId: runId,
      message: item.message,
      sourceProduct: input.product,
      sourcePlate: input.plate,
      occurredAt: input.occurredAt,
      quantity,
      amount,
      rawPayload: input.payload,
    },
  })
}

export async function recordFuelProviderIssues(runId: string, issues: DurableProviderIssue[], status: "rejected" | "pending" = "rejected") {
  const supplierIds = await supplierIdsFor(issues.map((issue) => issue.input.provider))
  for (const issue of issues) await recordRejectedItem(runId, issue, status, supplierIds.get(issue.input.provider) ?? null)
  return status === "pending" ? { pending: issues.length } : { rejected: issues.length }
}

export interface ProviderRowResolution {
  worksiteId?: string | null
  vehicleId?: string | null
  productId?: string | null
}

/**
 * Writes every boundary result. No row disappears into a warning: accepted
 * rows become ledger transactions; rejected and pending rows become both a
 * transaction state and a durable review item.
 */
export async function recordFuelProviderValidation(
  runId: string,
  result: ProviderValidationResult,
  resolve: (row: ProviderRowInput) => ProviderRowResolution = () => ({}),
) {
  let accepted = 0
  let pending = 0
  let rejected = 0
  const supplierIds = await supplierIdsFor([
    ...result.accepted.map((row) => row.provider),
    ...result.rejected.map((item) => item.input.provider),
    ...result.pending.map((item) => item.input.provider),
  ])

  for (const row of result.accepted) {
    const input: ProviderRowInput = {
      provider: row.provider,
      accountKey: row.accountKey,
      sourceRowKey: row.sourceRowKey,
      externalId: row.externalId,
      occurredAt: row.occurredAt,
      plate: row.plate,
      product: row.sourceProduct,
      quantity: row.quantity,
      amount: row.amount,
      payload: row.payload,
    }
    const resolution = resolve(input)
    const status = resolution.worksiteId && resolution.vehicleId && resolution.productId ? "accepted" : "pending"
    await db.insert(fuelProviderTransactions).values({
      id: nanoid(),
      syncRunId: runId,
      provider: row.provider,
      sourceAccount: row.accountKey,
      supplierId: supplierIds.get(row.provider) ?? null,
      identityKey: row.identityKey,
      externalId: row.externalId,
      fingerprint: row.fingerprint,
      sourceRowKey: row.sourceRowKey,
      worksiteId: resolution.worksiteId ?? null,
      vehicleId: resolution.vehicleId ?? null,
      productId: resolution.productId ?? null,
      sourceProduct: row.sourceProduct,
      sourcePlate: row.plate,
      occurredAt: row.occurredAt,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      amount: row.amount,
      status,
      resolutionCode: status === "accepted" ? null : "unresolved_mapping",
      resolutionMessage: status === "accepted" ? null : "La fila fue validada pero aún no tiene mapping completo",
      rawPayload: row.payload,
      payloadHash: jsonHash(row.payload),
      updatedAt: new Date().toISOString(),
    }).onConflictDoUpdate({
      target: [fuelProviderTransactions.provider, fuelProviderTransactions.sourceAccount, fuelProviderTransactions.identityKey],
      set: {
        syncRunId: runId,
        fingerprint: row.fingerprint,
        supplierId: supplierIds.get(row.provider) ?? null,
        worksiteId: resolution.worksiteId ?? null,
        vehicleId: resolution.vehicleId ?? null,
        productId: resolution.productId ?? null,
        sourceProduct: row.sourceProduct,
        sourcePlate: row.plate,
        occurredAt: row.occurredAt,
        quantity: row.quantity,
        unitPrice: row.unitPrice,
        amount: row.amount,
        status,
        resolutionCode: status === "accepted" ? null : "unresolved_mapping",
        resolutionMessage: status === "accepted" ? null : "La fila fue validada pero aún no tiene mapping completo",
        rawPayload: row.payload,
        payloadHash: jsonHash(row.payload),
        updatedAt: new Date().toISOString(),
      },
    })
    if (status === "accepted") accepted++
    else pending++
  }

  for (const item of result.rejected) {
    await recordRejectedItem(runId, item, "rejected", supplierIds.get(item.input.provider) ?? null)
    rejected++
  }
  for (const item of result.pending) {
    await recordRejectedItem(runId, item, "pending", supplierIds.get(item.input.provider) ?? null)
    pending++
  }

  return { accepted, rejected, pending }
}

export async function finishFuelProviderSyncRun(
  runId: string,
  input: {
    status: "success" | "partial" | "failed"
    receivedFrom?: string
    receivedTo?: string
    pages?: number
    files?: number
    rowsReceived: number
    rowsAccepted: number
    rowsRejected: number
    rowsPending: number
    rowsReprocessed?: number
    error?: string | null
  },
) {
  const [affected] = await db.select({
    quantity: sql<number>`coalesce(sum(case when ${fuelProviderTransactions.status} in ('pending', 'rejected') then coalesce(${fuelProviderTransactions.quantity}, 0) else 0 end), 0)`,
    amount: sql<number>`coalesce(sum(case when ${fuelProviderTransactions.status} in ('pending', 'rejected') then coalesce(${fuelProviderTransactions.amount}, 0) else 0 end), 0)`,
  }).from(fuelProviderTransactions).where(eq(fuelProviderTransactions.syncRunId, runId))
  const [run] = await db.update(fuelProviderSyncRuns).set({
    status: input.status,
    receivedFrom: input.receivedFrom,
    receivedTo: input.receivedTo,
    pages: input.pages ?? 0,
    files: input.files ?? 0,
    rowsReceived: input.rowsReceived,
    rowsAccepted: input.rowsAccepted,
    rowsRejected: input.rowsRejected,
    rowsPending: input.rowsPending,
    rowsReprocessed: input.rowsReprocessed ?? 0,
    affectedQuantity: Number(affected?.quantity ?? 0),
    affectedAmount: Number(affected?.amount ?? 0),
    error: input.error ?? null,
    finishedAt: new Date().toISOString(),
  }).where(and(eq(fuelProviderSyncRuns.id, runId), eq(fuelProviderSyncRuns.status, "running"))).returning({ id: fuelProviderSyncRuns.id })
  if (!run) throw new Error("La corrida de combustible ya estaba cerrada o no existe")
  return run
}
