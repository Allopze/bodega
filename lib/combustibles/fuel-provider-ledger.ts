import { createHash } from "node:crypto"
import { and, desc, eq, inArray, lt, lte, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  fuelProviderRejections,
  fuelProviderEventRevisions,
  fuelProviderSyncRuns,
  fuelProviderTransactions,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { fuelSupplierIdForProvider } from "./fuel-sources"
import { fingerprintProviderRow, type ProviderValidationResult, type ProviderRowInput } from "./provider-validation"

/** Una consulta por proveedor y por corrida: el catálogo puede cambiar entre
 *  corridas, así que no se cachea a nivel de módulo. */
async function supplierIdsFor(providers: Iterable<"copec">) {
  const resolved = new Map<string, string | null>()
  for (const provider of new Set(providers)) resolved.set(provider, await fuelSupplierIdForProvider(provider))
  return resolved
}

export interface FuelProviderSyncRunInput {
  provider: "copec"
  trigger: "manual" | "cron" | "reprocess"
  requestedFrom: string
  requestedTo: string
  actorUserId?: string
  correlationId?: string
}

export interface CopecSyncDetectionEvidence {
  status: string | null
  startedAt: string | null
  finishedAt: string | null
  rowsAccepted: number
  completedBeforeDetection: boolean
}

/**
 * Corrida Copec más reciente del mismo día chileno que había empezado al
 * iniciar la detección. No consulta ni modifica las filas importadas.
 */
export async function getCopecSyncDetectionEvidence(detectionStartedAt: string): Promise<CopecSyncDetectionEvidence> {
  const latestRun = await db.query.fuelProviderSyncRuns.findFirst({
    where: and(
      eq(fuelProviderSyncRuns.provider, "copec"),
      lte(fuelProviderSyncRuns.startedAt, detectionStartedAt),
      sql`(${fuelProviderSyncRuns.startedAt} AT TIME ZONE 'America/Santiago')::date = (${detectionStartedAt}::timestamptz AT TIME ZONE 'America/Santiago')::date`,
    ),
    orderBy: [desc(fuelProviderSyncRuns.startedAt)],
    columns: { status: true, startedAt: true, finishedAt: true, rowsAccepted: true },
  })
  const finishedAt = latestRun?.finishedAt ?? null
  const startedAt = latestRun?.startedAt ?? null
  const normalizedFinishedAt = finishedAt === null ? null : new Date(finishedAt).toISOString()
  return {
    status: latestRun?.status ?? null,
    startedAt: startedAt === null ? null : new Date(startedAt).toISOString(),
    finishedAt: normalizedFinishedAt,
    rowsAccepted: latestRun?.rowsAccepted ?? 0,
    completedBeforeDetection: normalizedFinishedAt !== null && new Date(normalizedFinishedAt).getTime() <= new Date(detectionStartedAt).getTime(),
  }
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
  const unitPrice = typeof input.unitPrice === "number" && Number.isFinite(input.unitPrice) && input.unitPrice >= 0 ? input.unitPrice : null
  const amount = typeof input.amount === "number" && Number.isFinite(input.amount) && input.amount >= 0 ? input.amount : null
  await db.insert(fuelProviderTransactions).values({
    id: nanoid(),
    syncRunId: runId,
    provider: input.provider,
    sourceAccount: input.accountKey,
    supplierId,
    identityKey,
    externalId: input.externalId === null || input.externalId === undefined ? null : String(input.externalId),
    documentNumber: input.documentNumber?.trim() || null,
    fingerprint: fingerprintProviderRow(input),
    sourceRowKey: input.sourceRowKey,
    sourceProduct: input.product,
    sourcePlate: input.plate,
    occurredAt: input.occurredAt,
    quantity,
    unitPrice,
    amount,
    status,
    granularity: input.granularity ?? "transaction",
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
      documentNumber: input.documentNumber?.trim() || null,
      sourceProduct: input.product,
      sourcePlate: input.plate,
      occurredAt: input.occurredAt,
      quantity,
      unitPrice,
      amount,
      status,
      granularity: input.granularity ?? "transaction",
      resolutionCode: item.code,
      resolutionMessage: item.message,
      rawPayload: input.payload,
      payloadHash: jsonHash(input.payload),
      updatedAt: new Date().toISOString(),
    },
    // Un duplicado NO pisa la fila que esta misma corrida acaba de escribir. La
    // identidad de una fila rechazada se calcula igual que la de una válida, así
    // que un `duplicate_identity` —la segunda aparición de la misma identidad
    // dentro de la respuesta externa— caía sobre la primera y le cambiaba el
    // estado y los montos por los del duplicado. La cota va por corrida y no por
    // estado: la fila buena puede haber quedado `accepted` o `pending` según su
    // mapping, y una fila de una corrida ANTERIOR sí debe poder actualizarse. La
    // constancia del duplicado igual queda en `fuel_provider_rejections`, cuya
    // clave única es otra.
    setWhere: item.code === "duplicate_identity"
      ? ne(fuelProviderTransactions.syncRunId, runId)
      : undefined,
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

/* ── Revisión de correcciones y filas rechazadas (C2 / 4.2) ───────────────── */

/**
 * Una fila abierta de `fuel_provider_rejections`: lo que una persona tiene que
 * mirar (una corrección del proveedor, una fila inválida, una tarjeta sin
 * estanque). Antes nadie las cerraba y la lista crecía sin techo, además de
 * dejar el mes `incomplete` para siempre.
 */
export interface CopecOpenRejection {
  id: string
  sourceAccount: string
  sourceRowKey: string
  code: string
  message: string
  sourceProduct: string | null
  sourcePlate: string | null
  occurredAt: string | null
  quantity: number | null
  amount: number | null
  status: "open"
  createdAt: string
  /**
   * Es una propuesta de corrección del proveedor (`CORRECTION_REVIEW_CODES`).
   * Sólo éstas se pueden aprobar; una fila inválida o una tarjeta sin estanque
   * se marca como revisada (`dismissed`).
   */
  isCorrection: boolean
}

/** Códigos que son propuestas de corrección: su resolución cambia la evidencia. */
export const CORRECTION_REVIEW_CODES = ["possible_provider_correction", "tae_guide_correction_review"] as const

export function isCorrectionReviewCode(code: string): boolean {
  return (CORRECTION_REVIEW_CODES as readonly string[]).includes(code)
}

export async function listOpenCopecRejections(options: { limit?: number } = {}): Promise<CopecOpenRejection[]> {
  const rows = await db.query.fuelProviderRejections.findMany({
    where: and(eq(fuelProviderRejections.provider, "copec"), eq(fuelProviderRejections.status, "open")),
    orderBy: [desc(fuelProviderRejections.createdAt)],
    limit: options.limit ?? 50,
    columns: {
      id: true,
      sourceAccount: true,
      sourceRowKey: true,
      code: true,
      message: true,
      sourceProduct: true,
      sourcePlate: true,
      occurredAt: true,
      quantity: true,
      amount: true,
      status: true,
      createdAt: true,
    },
  })
  return rows.map((row) => ({ ...row, status: "open" as const, isCorrection: isCorrectionReviewCode(row.code) }))
}

export interface RejectionResolution {
  rejectionId: string
  status: "resolved" | "dismissed"
  /** Motivo obligatorio: queda en la bitácora y en la fila. */
  reason: string
  actorUserId: string
  actorEmail?: string | null
}

/**
 * Cierra una fila de revisión del proveedor con actor, motivo y auditoría.
 *
 * - `resolved`: la observación del proveedor es correcta y reemplaza la
 *   evidencia previa. La próxima corrida la aplica —`importCopecPeriod` lee
 *   esta decisión—, marca la carga original como `superseded` y proyecta la
 *   nueva.
 * - `dismissed`: se revisó y la evidencia original se mantiene. La próxima
 *   corrida ignora la observación, que es lo que permite cerrar el mes.
 *
 * La transacción de revisión (`row:…:correction-review`) deja de estar
 * `pending` en ambos casos: si siguiera pendiente, `rowsPending` del mes nunca
 * bajaría y la pantalla seguiría pidiendo lo mismo.
 */
export async function resolveFuelProviderRejection(input: RejectionResolution): Promise<{ ok: true }> {
  const reason = input.reason.trim()
  if (reason.length < 10) throw new Error("Escribe el motivo de la decisión (al menos 10 caracteres)")
  const [rejection] = await db.select().from(fuelProviderRejections).where(eq(fuelProviderRejections.id, input.rejectionId)).limit(1)
  if (!rejection) throw new Error("La observación no existe")
  if (rejection.status !== "open") throw new Error("La observación ya fue resuelta")
  // Aprobar = la fila del proveedor reemplaza a la carga anterior. Eso sólo tiene
  // sentido para una corrección: aprobar una fila inválida la marcaría
  // `superseded` con `correction_approved` sin que haya nada que la reemplace.
  if (input.status === "resolved" && !isCorrectionReviewCode(rejection.code)) {
    throw new Error("Sólo una corrección del proveedor se puede aprobar; esta fila se marca como revisada")
  }

  const now = new Date().toISOString()
  const account = rejection.sourceAccount
  const reviewIdentity = `row:${rejection.provider}:${account}:${rejection.sourceRowKey}`
  await db.transaction(async (tx) => {
    await tx.update(fuelProviderRejections).set({
      status: input.status,
      resolvedBy: input.actorUserId,
      resolvedAt: now,
    }).where(eq(fuelProviderRejections.id, rejection.id))
    // La observación deja de contar como trabajo pendiente del mes.
    await tx.update(fuelProviderTransactions).set({
      status: input.status === "resolved" ? "superseded" : "excluded",
      resolutionCode: input.status === "resolved" ? "correction_approved" : "correction_dismissed",
      resolutionMessage: reason,
      updatedAt: now,
    }).where(and(
      eq(fuelProviderTransactions.provider, rejection.provider),
      eq(fuelProviderTransactions.sourceAccount, account),
      eq(fuelProviderTransactions.identityKey, reviewIdentity),
      eq(fuelProviderTransactions.status, "pending"),
    ))
    await recordAudit({
      userId: input.actorUserId,
      userEmail: input.actorEmail ?? undefined,
      action: "status_change",
      entityType: "fuel_provider_rejection",
      entityId: rejection.id,
      entityCode: `${rejection.code} ${rejection.sourcePlate ?? rejection.sourceRowKey}`.slice(0, 120),
      oldState: { status: rejection.status },
      newState: { status: input.status, code: rejection.code, sourceAccount: account },
      reason,
    }, tx)
  })
  return { ok: true }
}

/**
 * Marca cargas ya registradas como reemplazadas por una corrección aprobada.
 *
 * `superseded` es el estado del catálogo (`fuel_provider_transactions_status_valid`)
 * y el que `priorCopecEvents` excluye: sin él, la corrección aplicada seguía
 * comparándose contra la evidencia vieja y el mes no convergía (C2 / 4.2).
 * Queda una revisión en `fuel_provider_event_revisions` para poder auditar qué
 * decía la fila reemplazada.
 */
export async function markCopecEventsSuperseded(
  transactionIds: string[],
  context: { reason: string; actorUserId?: string; runId?: string },
): Promise<number> {
  const ids = [...new Set(transactionIds)]
  if (ids.length === 0) return 0
  const rows = await db.select({
    id: fuelProviderTransactions.id,
    syncRunId: fuelProviderTransactions.syncRunId,
    fingerprint: fuelProviderTransactions.fingerprint,
    quantity: fuelProviderTransactions.quantity,
    unitPrice: fuelProviderTransactions.unitPrice,
    amount: fuelProviderTransactions.amount,
    status: fuelProviderTransactions.status,
    payloadHash: fuelProviderTransactions.payloadHash,
    rawPayload: fuelProviderTransactions.rawPayload,
  }).from(fuelProviderTransactions).where(inArray(fuelProviderTransactions.id, ids))
  let updated = 0
  for (const row of rows) {
    await db.update(fuelProviderTransactions).set({
      status: "superseded",
      resolutionCode: "replaced_by_correction",
      resolutionMessage: context.reason,
      updatedAt: new Date().toISOString(),
    }).where(and(eq(fuelProviderTransactions.id, row.id), ne(fuelProviderTransactions.status, "superseded")))
    // Una fila `superseded` no se puede volver a versionar con la misma huella
    // (índice único por transacción+huella+archivo); el `onConflictDoNothing`
    // deja constancia sólo la primera vez, que es cuando importa.
    await db.insert(fuelProviderEventRevisions).values({
      id: nanoid(),
      transactionId: row.id,
      syncRunId: context.runId ?? row.syncRunId,
      sourceFileId: null,
      fingerprint: row.fingerprint,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      amount: row.amount,
      amountBasis: "reported",
      status: "superseded",
      payloadHash: row.payloadHash,
      rawPayload: row.rawPayload,
    }).onConflictDoNothing()
    updated++
  }
  return updated
}

/**
 * Cierra las corridas que quedaron `running` porque el proceso murió antes del
 * `catch` (C7 / 4.7). No borra nada: las deja `failed` con el motivo, para que
 * la pantalla deje de decir «sincronizando ahora» y el operador vea que ese mes
 * se tiene que reintentar.
 */
export async function closeStaleFuelProviderSyncRuns(input: { provider: "copec"; olderThanMs: number; now?: number }): Promise<number> {
  const cutoff = new Date((input.now ?? Date.now()) - input.olderThanMs).toISOString()
  const stale = await db.select({ id: fuelProviderSyncRuns.id, requestedFrom: fuelProviderSyncRuns.requestedFrom })
    .from(fuelProviderSyncRuns)
    .where(and(
      eq(fuelProviderSyncRuns.provider, input.provider),
      eq(fuelProviderSyncRuns.status, "running"),
      lt(fuelProviderSyncRuns.startedAt, cutoff),
    ))
  let closed = 0
  for (const run of stale) {
    const [updated] = await db.update(fuelProviderSyncRuns).set({
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: "La corrida quedó abierta: el proceso se interrumpió antes de terminarla. Vuelve a sincronizar ese mes.",
    }).where(and(eq(fuelProviderSyncRuns.id, run.id), eq(fuelProviderSyncRuns.status, "running"))).returning({ id: fuelProviderSyncRuns.id })
    if (updated) closed++
  }
  return closed
}

export interface ProviderRowResolution {
  worksiteId?: string | null
  vehicleId?: string | null
  storageLocationId?: string | null
  productId?: string | null
  /**
   * La fila no es de esta empresa (p. ej. una patente que no está en la flota):
   * queda `excluded`, con este motivo, y no cuenta como consumo ni como
   * pendiente. Si después la patente entra a la flota, la próxima corrida del
   * mes la reevalúa.
   */
  excluded?: { code: string; message: string }
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
  options: { sourceFileId?: string | null } = {},
) {
  let accepted = 0
  let pending = 0
  let rejected = 0
  let excluded = 0
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
      documentNumber: row.documentNumber,
      occurredAt: row.occurredAt,
      sourceDate: row.sourceDate,
      periodEnd: row.periodEnd,
      plate: row.plate,
      product: row.sourceProduct,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      amount: row.amount,
      payload: row.payload,
      granularity: row.granularity,
    }
    const resolution = resolve(input)
    const mappedTaeReceipt = row.provider === "copec" && row.accountKey.startsWith("tae:") && resolution.worksiteId && resolution.storageLocationId && resolution.productId
    const status = resolution.excluded ? "excluded" : resolution.worksiteId && resolution.productId && (resolution.vehicleId || mappedTaeReceipt) ? "accepted" : "pending"
    const resolutionCode = status === "accepted" ? null : resolution.excluded?.code ?? "unresolved_mapping"
    const resolutionMessage = status === "accepted" ? null : resolution.excluded?.message ?? "La fila fue validada pero aún no tiene mapping completo"
    await db.insert(fuelProviderTransactions).values({
      id: nanoid(),
      syncRunId: runId,
      provider: row.provider,
      sourceAccount: row.accountKey,
      supplierId: supplierIds.get(row.provider) ?? null,
      identityKey: row.identityKey,
      externalId: row.externalId,
      documentNumber: row.documentNumber,
      fingerprint: row.fingerprint,
      sourceRowKey: row.sourceRowKey,
      worksiteId: resolution.worksiteId ?? null,
      vehicleId: resolution.vehicleId ?? null,
      storageLocationId: resolution.storageLocationId ?? null,
      productId: resolution.productId ?? null,
      sourceProduct: row.sourceProduct,
      sourcePlate: row.sourcePlate,
      occurredAt: row.occurredAt,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      amount: row.amount,
      status,
      granularity: row.granularity,
      resolutionCode,
      resolutionMessage,
      rawPayload: row.payload,
      payloadHash: jsonHash(row.payload),
      updatedAt: new Date().toISOString(),
    }).onConflictDoUpdate({
      target: [fuelProviderTransactions.provider, fuelProviderTransactions.sourceAccount, fuelProviderTransactions.identityKey],
      set: {
        syncRunId: runId,
        fingerprint: row.fingerprint,
        documentNumber: row.documentNumber,
        supplierId: supplierIds.get(row.provider) ?? null,
        worksiteId: resolution.worksiteId ?? null,
        vehicleId: resolution.vehicleId ?? null,
        storageLocationId: resolution.storageLocationId ?? null,
        productId: resolution.productId ?? null,
        sourceProduct: row.sourceProduct,
        sourcePlate: row.sourcePlate,
        occurredAt: row.occurredAt,
        quantity: row.quantity,
        unitPrice: row.unitPrice,
        amount: row.amount,
        status,
        granularity: row.granularity,
        resolutionCode,
        resolutionMessage,
        rawPayload: row.payload,
        payloadHash: jsonHash(row.payload),
        updatedAt: new Date().toISOString(),
      },
    })
    const persisted = await db.query.fuelProviderTransactions.findFirst({
      where: and(
        eq(fuelProviderTransactions.provider, row.provider),
        eq(fuelProviderTransactions.sourceAccount, row.accountKey),
        eq(fuelProviderTransactions.identityKey, row.identityKey),
      ),
      columns: { id: true },
    })
    if (persisted) {
      await db.insert(fuelProviderEventRevisions).values({
        id: nanoid(),
        transactionId: persisted.id,
        syncRunId: runId,
        sourceFileId: options.sourceFileId ?? null,
        fingerprint: row.fingerprint,
        quantity: row.quantity,
        unitPrice: row.unitPrice,
        amount: row.amount,
        amountBasis: "reported",
        status,
        payloadHash: jsonHash(row.payload),
        rawPayload: row.payload,
      }).onConflictDoNothing()
    }
    if (status === "accepted") accepted++
    else if (status === "excluded") excluded++
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

  return { accepted, rejected, pending, excluded }
}

export interface AffectedRunRow {
  sourceAccount: string
  sourcePlate: string | null
  occurredAt: string | null
  quantity: number | null
  amount: number | null
  identityKey: string
  granularity: string
}

/** Litros y monto afectados de una corrida, sin contar dos veces la misma carga (4.10). */
export function affectedRunImpact(rows: readonly AffectedRunRow[]): { affectedQuantity: number; affectedAmount: number } {
  const plateKey = (row: AffectedRunRow) => `${row.sourceAccount}|${row.sourcePlate ?? ""}`
  const platesWithDetail = new Set(rows.filter((row) => row.granularity !== "period_aggregate").map(plateKey))
  const counted = rows.filter((row) => row.granularity !== "period_aggregate" || !platesWithDetail.has(plateKey(row)))
  // Por valor, cuántas filas hay en cada espacio de identidad (`row:` / `external:` …).
  const byValue = new Map<string, { quantity: number; amount: number; perNamespace: Map<string, number> }>()
  for (const row of counted) {
    const key = `${row.sourceAccount}|${row.sourcePlate ?? ""}|${row.occurredAt ?? ""}|${row.quantity ?? ""}|${row.amount ?? ""}`
    const namespace = row.identityKey.split(":", 1)[0] ?? ""
    const entry = byValue.get(key) ?? { quantity: row.quantity ?? 0, amount: row.amount ?? 0, perNamespace: new Map<string, number>() }
    entry.perNamespace.set(namespace, (entry.perNamespace.get(namespace) ?? 0) + 1)
    byValue.set(key, entry)
  }
  let affectedQuantity = 0
  let affectedAmount = 0
  for (const entry of byValue.values()) {
    const times = Math.max(...entry.perNamespace.values())
    affectedQuantity += entry.quantity * times
    affectedAmount += entry.amount * times
  }
  return { affectedQuantity, affectedAmount }
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
  // C10 / 4.10: el impacto de la corrida no puede contar dos veces los mismos litros.
  // - Una tarjeta TAE sin estanque deja DOS filas pendientes con los mismos
  //   litros y monto (`row:copec:tae:*` y `external:<guía>`): son dos espacios de
  //   identidad que describen la misma carga. Se cuenta una vez por valor, pero
  //   dentro de un mismo espacio cada fila cuenta: dos cargas idénticas de verdad
  //   (ocurrencia 1 y 2 de la misma firma) siguen siendo dos.
  // - Con detalle TCT, el agregado mensual de una patente y sus transacciones
  //   quedan pendientes en la misma corrida: el agregado es la suma de ellas, así
  //   que sólo cuenta si esa patente no trajo transacciones.
  const affectedRows = await db.select({
    sourceAccount: fuelProviderTransactions.sourceAccount,
    sourcePlate: fuelProviderTransactions.sourcePlate,
    occurredAt: fuelProviderTransactions.occurredAt,
    quantity: fuelProviderTransactions.quantity,
    amount: fuelProviderTransactions.amount,
    identityKey: fuelProviderTransactions.identityKey,
    granularity: fuelProviderTransactions.granularity,
  }).from(fuelProviderTransactions).where(and(
    eq(fuelProviderTransactions.syncRunId, runId),
    inArray(fuelProviderTransactions.status, ["pending", "rejected"]),
  ))
  const { affectedQuantity, affectedAmount } = affectedRunImpact(affectedRows)
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
    affectedQuantity: Math.round(affectedQuantity * 10_000) / 10_000,
    affectedAmount: Math.round(affectedAmount * 100) / 100,
    error: input.error ?? null,
    finishedAt: new Date().toISOString(),
  }).where(and(eq(fuelProviderSyncRuns.id, runId), eq(fuelProviderSyncRuns.status, "running"))).returning({ id: fuelProviderSyncRuns.id })
  if (!run) throw new Error("La corrida de combustible ya estaba cerrada o no existe")
  return run
}
