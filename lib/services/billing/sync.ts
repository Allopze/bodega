/**
 * lib/services/billing/sync.ts
 *
 * Sincronización de facturas desde cualquier proveedor.
 *
 * Propiedades que el módulo exige y acá se cumplen:
 *
 * - **Idempotente.** Dos corridas con los mismos datos dejan la base igual.
 *   La identidad tributaria y `(provider, external_id)` cierran los duplicados.
 * - **Segura ante concurrencia.** El índice único parcial
 *   `billing_sync_runs_single_active_unique` permite una sola corrida `running`
 *   por (proveedor, alcance, período): la segunda choca en la base, no compite.
 * - **Modo simulación.** `dryRun` consulta y compara pero no escribe nada del
 *   modelo; deja la corrida con las métricas de lo que HABRÍA hecho.
 * - **Acotada.** Siempre por período, con piso configurable para el histórico.
 * - **Observable.** Cada corrida registra fetched/created/updated/unchanged,
 *   duplicados, conflictos, errores y un id de correlación.
 * - **Independiente de la sesión web.** No lee la sesión: el actor se pasa.
 *
 * Un documento que llega sin RUT de contraparte NO se inserta con un valor
 * inventado: se cuenta como conflicto y se reporta. Es la diferencia entre un
 * dato faltante visible y un dato falso invisible.
 */

import { createHash } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { billingBankTransactions, billingSyncRuns, type BillingProviderId } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { logger } from "@/lib/logger"
import { readBillingCursor, usesDurableBillingCursor, writeBillingCursor } from "./sales-xml-cursor"
import { readSalesSyncConfig } from "./config"
import { chilePeriod, previousChilePeriod } from "../dte-portal/chile-time"
import { classifyDteFailure } from "../dte-portal/failure"
import { DtePortalError } from "../dte-portal/types"
import { BillingExternalReferenceConflict, BillingExternalReferenceInvalid, upsertProviderInvoice } from "./invoices"
import { assertCapability, BillingProviderError, getBillingProvider, isProviderEnabled } from "./providers"
import type { BillingProvider } from "./providers/types"

/** Corridas `running` más viejas que esto quedaron colgadas (proceso muerto). */
const STALE_RUN_THRESHOLD_MS = 60 * 60 * 1000

/** Tope de páginas por corrida: cinturón contra un cursor que no avanza. */
const MAX_PAGES_PER_RUN = 50

export type BillingSyncScope = "sales_invoices" | "purchase_invoices" | "bank_transactions"

export interface BillingSyncOptions {
  provider: BillingProviderId
  scope: BillingSyncScope
  /** Período "YYYY-MM". Default: mes actual. */
  period?: string
  trigger?: "manual" | "cron" | "backfill"
  /** Consulta y compara sin escribir. */
  dryRun?: boolean
  /** Usuario que dispara la corrida. Null en cron. */
  triggeredBy?: string | null
  /** Reanudar desde este cursor. */
  cursor?: string | null
  /** Batch compartido cuando un cron cubre varios períodos o dominios. */
  correlationId?: string
}

export interface BillingSyncResult {
  runId: string
  correlationId: string
  provider: BillingProviderId
  scope: BillingSyncScope
  period: string
  status: "success" | "partial" | "failed" | "skipped"
  dryRun: boolean
  recordsFetched: number
  recordsCreated: number
  recordsUpdated: number
  recordsUnchanged: number
  duplicatesDetected: number
  conflictsDetected: number
  errorsCount: number
  errorSummary: string | null
  /** Machine-readable reason when a run never started. */
  skipReason?: "provider_disabled" | "not_configured" | "active_run" | "unsupported"
}

/**
 * Sincroniza un período. No lanza por errores de datos: los cuenta y los deja
 * en la corrida, porque ocultar un error de sincronización es peor que
 * reportarlo a medias.
 */
export async function syncBillingInvoices(options: BillingSyncOptions): Promise<BillingSyncResult> {
  const period = options.period ?? currentPeriod()
  const trigger = options.trigger ?? "manual"
  const dryRun = options.dryRun ?? false
  const correlationId = options.correlationId ?? nanoid(12)

  assertPeriodFormat(period)
  assertPeriodFloor(period)

  if (!(await isProviderEnabled(options.provider))) {
    return skipped({
      runId: "", correlationId, provider: options.provider, scope: options.scope, period, dryRun,
      reason: "El proveedor está deshabilitado por configuración.", skipReason: "provider_disabled",
    })
  }

  const provider = getBillingProvider(options.provider)
  if (!(await provider.isConfigured())) {
    return skipped({
      runId: "", correlationId, provider: options.provider, scope: options.scope, period, dryRun,
      reason: "El proveedor no está configurado en este servidor.", skipReason: "not_configured",
    })
  }

  if (!dryRun) await markStaleRunsAsFailed(options.provider, options.scope)

  // FacturaEnLínea's sales list is one large HTML response. Its XML-enrichment
  // cursor lives independently of transient run rows so a crash resumes the
  // same deterministic batch instead of silently abandoning documents >120.
  const managedCursor = usesDurableBillingCursor(options.provider, options.scope)
  const initialCursor = options.cursor ?? (managedCursor
    ? await readBillingCursor(options.provider, options.scope, period)
    : null)

  const runId = dryRun ? "" : nanoid()
  if (!dryRun) {
    try {
      await db.insert(billingSyncRuns).values({
        id: runId,
        provider: options.provider,
        scope: options.scope,
        trigger,
        status: "running",
        dryRun: false,
        periodFrom: period,
        periodTo: period,
        cursor: initialCursor,
        correlationId,
        triggeredBy: options.triggeredBy ?? null,
      })
    } catch (error) {
      // Sólo el índice único parcial significa "ya hay una corrida activa". Una
      // base caída, un timeout o una FK rota son incidentes que deben propagarse:
      // reportarlos como "ya está corriendo" es un diagnóstico falso justo donde
      // más se necesita el verdadero (H-09, AUDITORIA_BUGS_2026-08-05.md).
      if (!isSingleActiveRunConflict(error)) throw error
      return skipped({
        runId: "", correlationId, provider: options.provider, scope: options.scope, period, dryRun,
        reason: "Ya hay una sincronización en curso para este período.", skipReason: "active_run",
      })
    }
  }

  const metrics = {
    recordsFetched: 0,
    recordsCreated: 0,
    recordsUpdated: 0,
    recordsUnchanged: 0,
    duplicatesDetected: 0,
    conflictsDetected: 0,
    errorsCount: 0,
  }
  const errors: string[] = []
  let status: BillingSyncResult["status"] = "success"
  let cursor: string | null = initialCursor

  try {
    const seenExternalIds = new Set<string>()
    let pages = 0

    do {
      const page = await fetchPage(provider, options.scope, { period, cursor, correlationId })
      pages++
      metrics.recordsFetched += page.items.length
      const errorsBeforePage = metrics.errorsCount

      // El proveedor no supo decir cuántos documentos tiene el período. Sin ese
      // número no hay nada contra qué contrastar lo entregado, así que la
      // corrida no puede afirmar completitud: mismo criterio que el sync de
      // compras (`dte-portal/sync.ts`), que cierra `partial` en este caso.
      if (page.completenessUnverified && pages === 1) {
        errors.push(
          `El proveedor no declaró el total del período: no se pudo verificar la completitud (se leyeron ${page.items.length} documentos).`,
        )
        status = "partial"
      }

      if (page.reportedTotal !== null && pages === 1 && page.reportedTotal !== page.items.length && page.nextCursor === null) {
        // El proveedor declaró un total distinto al que entregó en una sola
        // página: señal de que la suposición de "sin paginación" dejó de valer.
        errors.push(
          `El proveedor declaró ${page.reportedTotal} documentos y entregó ${page.items.length} sin cursor.`,
        )
        status = "partial"
      }

      for (const invoice of page.items) {
        // Repetido dentro de la MISMA respuesta: el proveedor lo duplicó.
        if (seenExternalIds.has(invoice.externalId)) {
          metrics.duplicatesDetected++
          continue
        }
        seenExternalIds.add(invoice.externalId)

        if (!invoice.issuerTaxId || !invoice.receiverTaxId) {
          metrics.conflictsDetected++
          errors.push(
            `Documento ${invoice.docType}/${invoice.folio} sin RUT de contraparte: no se pudo identificar (¿XML no disponible?).`,
          )
          continue
        }

        if (dryRun) {
          // En simulación no se escribe: solo se cuenta como "lo que llegaría".
          metrics.recordsUnchanged++
          continue
        }

        try {
          const result = await db.transaction((tx) =>
            upsertProviderInvoice(tx, invoice, options.provider),
          )
          if (result.outcome === "inserted") metrics.recordsCreated++
          else if (result.outcome === "updated") metrics.recordsUpdated++
          else metrics.recordsUnchanged++
        } catch (error) {
          metrics.errorsCount++
          const message = redact(error)
          errors.push(`Folio ${invoice.folio} (${invoice.docType}): ${message}`)
          logger.error(`[billing/sync ${correlationId}] documento falló`, { folio: invoice.folio, message })
        }
      }

      const mustRetryPage = Boolean(page.retryRequired) || metrics.errorsCount > errorsBeforePage
      cursor = mustRetryPage ? cursor : page.nextCursor
      if (!dryRun && (managedCursor || page.managedCursor)) {
        // All selected invoice writes above completed (or we deliberately keep
        // the old cursor), so this cursor cannot skip an unpersisted XML.
        await writeBillingCursor(options.provider, options.scope, period, cursor)
      }
      if (page.deferred || mustRetryPage) {
        errors.push(mustRetryPage
          ? "Quedan XML pendientes de reintento; el cursor no avanzó."
          : "Quedan XML por enriquecer; la siguiente corrida retoma el cursor.")
        status = "partial"
        break
      }
      if (pages >= MAX_PAGES_PER_RUN && cursor) {
        errors.push(`Se alcanzó el tope de ${MAX_PAGES_PER_RUN} páginas; la corrida queda reanudable por cursor.`)
        status = "partial"
        break
      }
    } while (cursor)

    if (metrics.errorsCount > 0) {
      status = metrics.errorsCount === metrics.recordsFetched ? "failed" : "partial"
    } else if (metrics.conflictsDetected > 0 && status === "success") {
      status = "partial"
    }
  } catch (error) {
    status = "failed"
    metrics.errorsCount++
    errors.push(redact(error))
    logger.error(`[billing/sync ${correlationId}] corrida falló`, { message: redact(error) })
  }

  if (!dryRun && managedCursor) {
    // A partial run must remain visibly resumable even when the last page had
    // no `nextCursor` (for example, a conflict on the final page). Repeating
    // that page is safe because invoice identity is idempotent; silently
    // deleting the durable key would make the operator believe the batch was
    // complete.
    const durableCursor = resumableCursor(status, initialCursor, cursor, metrics.recordsFetched)
    try {
      await writeBillingCursor(options.provider, options.scope, period, durableCursor)
      cursor = durableCursor
    } catch (error) {
      status = "failed"
      metrics.errorsCount++
      errors.push(redact(error))
    }
  }

  const errorSummary = errors.length > 0 ? truncateSummary(errors) : null

  if (!dryRun) {
    await db.update(billingSyncRuns).set({
      status,
      cursor,
      ...metrics,
      errorSummary,
      finishedAt: new Date().toISOString(),
    }).where(eq(billingSyncRuns.id, runId))
  }

  return {
    runId, correlationId, provider: options.provider, scope: options.scope, period,
    status, dryRun, ...metrics, errorSummary,
  }
}

/* ── Interno ─────────────────────────────────────────────────────────────── */

async function fetchPage(
  provider: BillingProvider,
  scope: BillingSyncScope,
  query: { period: string; cursor: string | null; correlationId?: string },
) {
  if (scope === "sales_invoices") {
    assertCapability(provider, "canListIssuedInvoices", "listIssuedInvoices")
    return provider.listIssuedInvoices!(query)
  }
  assertCapability(provider, "canListReceivedInvoices", "listReceivedInvoices")
  return provider.listReceivedInvoices!(query)
}

/**
 * Sincroniza movimientos bancarios: el insumo del motor de conciliación.
 *
 * Va aparte de `syncBillingInvoices` porque no son documentos: no tienen
 * identidad tributaria, no se vinculan a la operación y su deduplicación es
 * simplemente `(provider, external_id)`. Forzarlos por el mismo camino habría
 * significado un modelo que no le calza a ninguno de los dos.
 */
export async function syncBankTransactions(options: {
  provider: BillingProviderId
  period?: string
  trigger?: "manual" | "cron" | "backfill"
  triggeredBy?: string | null
  cursor?: string | null
  correlationId?: string
}): Promise<BillingSyncResult> {
  const period = options.period ?? currentPeriod()
  const correlationId = options.correlationId ?? nanoid(12)
  assertPeriodFormat(period)
  assertPeriodFloor(period)

  const base = {
    runId: "", correlationId, provider: options.provider,
    scope: "bank_transactions" as BillingSyncScope, period, dryRun: false,
  }

  if (!(await isProviderEnabled(options.provider))) {
    return skipped({ ...base, reason: "El proveedor está deshabilitado por configuración.", skipReason: "provider_disabled" })
  }
  const provider = getBillingProvider(options.provider)
  if (!provider.capabilities.canListBankTransactions) {
    return skipped({ ...base, reason: `${provider.label} no entrega movimientos bancarios.`, skipReason: "unsupported" })
  }
  if (!(await provider.isConfigured())) {
    return skipped({ ...base, reason: "El proveedor no está configurado en este servidor.", skipReason: "not_configured" })
  }

  // Sin esto, una corrida de cartolas cuyo proceso murió deja una fila
  // `running` que el índice único parcial nunca deja reemplazar: el período
  // queda bloqueado para siempre (H-07, AUDITORIA_BUGS_2026-08-05.md).
  await markStaleRunsAsFailed(options.provider, "bank_transactions")

  const managedCursor = usesDurableBillingCursor(options.provider, "bank_transactions")
  const initialCursor = options.cursor ?? (managedCursor
    ? await readBillingCursor(options.provider, "bank_transactions", period)
    : null)

  const runId = nanoid()
  try {
    await db.insert(billingSyncRuns).values({
      id: runId, provider: options.provider, scope: "bank_transactions",
      trigger: options.trigger ?? "manual", status: "running", dryRun: false,
      periodFrom: period, periodTo: period, correlationId, cursor: initialCursor,
      triggeredBy: options.triggeredBy ?? null,
    })
  } catch (error) {
    if (!isSingleActiveRunConflict(error)) throw error
    return skipped({ ...base, reason: "Ya hay una sincronización en curso para este período.", skipReason: "active_run" })
  }

  const metrics = {
    recordsFetched: 0, recordsCreated: 0, recordsUpdated: 0, recordsUnchanged: 0,
    duplicatesDetected: 0, conflictsDetected: 0, errorsCount: 0,
  }
  const errors: string[] = []
  let status: BillingSyncResult["status"] = "success"
  let cursor: string | null = initialCursor
  let pages = 0
  /** Total declarado por el proveedor en la primera página, si lo entrega. */
  let reportedTotal: number | null = null

  try {
    do {
      const page = await provider.listBankTransactions!({ period, cursor })
      pages++
      if (pages === 1) reportedTotal = page.reportedTotal
      metrics.recordsFetched += page.items.length
      const errorsBeforePage = metrics.errorsCount

      for (const transaction of page.items) {
        try {
          const hash = bankTransactionHash(transaction)

          const result = await db.insert(billingBankTransactions).values({
            id: nanoid(),
            provider: options.provider,
            externalId: transaction.externalId,
            transactionDate: transaction.transactionDate,
            amount: transaction.amount,
            currency: transaction.currency,
            description: transaction.description,
            counterpartyName: transaction.counterpartyName,
            counterpartyTaxId: transaction.counterpartyTaxId,
            accountRef: transaction.accountRef,
            payloadHash: hash,
            syncedAt: new Date().toISOString(),
          }).onConflictDoNothing({
            target: [billingBankTransactions.provider, billingBankTransactions.externalId],
          }).returning({ id: billingBankTransactions.id })

          // `onConflictDoNothing` no devuelve fila cuando ya existía: eso es lo
          // que hace idempotente la corrida sin pisar la imputación acumulada.
          if (result.length > 0) {
            metrics.recordsCreated++
            continue
          }

          // Ya existía: comparar el hash es lo que le da sentido a la columna.
          // Si el banco rectificó fecha o monto de un movimiento ya imputado,
          // pisarlo en silencio corrompería la conciliación y no pisarlo sin
          // avisar oculta la diferencia. Se reporta como conflicto y lo
          // resuelve una persona (H-14, AUDITORIA_BUGS_2026-08-05.md).
          const [stored] = await db
            .select({ payloadHash: billingBankTransactions.payloadHash })
            .from(billingBankTransactions)
            .where(and(
              eq(billingBankTransactions.provider, options.provider),
              eq(billingBankTransactions.externalId, transaction.externalId),
            ))
            .limit(1)

          if (stored && stored.payloadHash !== hash) {
            metrics.conflictsDetected++
            errors.push(
              `El movimiento ${transaction.externalId} cambió en el proveedor (fecha o monto) después de importarse: ` +
              `no se sobrescribe para no alterar lo ya imputado. Revísalo a mano.`,
            )
          } else {
            metrics.recordsUnchanged++
          }
        } catch (error) {
          metrics.errorsCount++
          errors.push(redact(error))
        }
      }

      const mustRetryPage = Boolean(page.retryRequired) || metrics.errorsCount > errorsBeforePage
      cursor = mustRetryPage ? cursor : page.nextCursor
      if (managedCursor || page.managedCursor) {
        await writeBillingCursor(options.provider, "bank_transactions", period, cursor)
      }
      if (mustRetryPage) {
        errors.push("La página de cartolas no se confirmó completamente; el cursor no avanzó.")
        status = "partial"
        break
      }
      if (pages >= MAX_PAGES_PER_RUN && cursor) {
        errors.push(`Se alcanzó el tope de ${MAX_PAGES_PER_RUN} páginas; la corrida queda reanudable por cursor.`)
        status = "partial"
        break
      }
    } while (cursor)

    // Detector de pérdida: la cartola no tiene folio ni identidad tributaria, así
    // que el total declarado es la única señal de que el proveedor entregó menos
    // movimientos de los que dice tener. Sólo cuenta cuando esta corrida leyó el
    // período completo: si arrancó desde un cursor, lo ya importado por corridas
    // anteriores no está en `recordsFetched` y comparar mentiría. Y si se cortó
    // por tope o reintento (`cursor` vivo) la corrida ya quedó `partial`.
    if (
      initialCursor === null && cursor === null
      && reportedTotal !== null && metrics.recordsFetched < reportedTotal
    ) {
      errors.push(
        `El proveedor declaró ${reportedTotal} movimientos y entregó ${metrics.recordsFetched}.`,
      )
      status = "partial"
    }

    if (metrics.errorsCount > 0) {
      status = metrics.errorsCount === metrics.recordsFetched ? "failed" : "partial"
    } else if (metrics.conflictsDetected > 0 && status === "success") {
      status = "partial"
    }
  } catch (error) {
    status = "failed"
    metrics.errorsCount++
    errors.push(redact(error))
    logger.error(`[billing/sync ${correlationId}] cartolas fallaron`, { message: redact(error) })
  }

  if (managedCursor) {
    const durableCursor = resumableCursor(status, initialCursor, cursor, metrics.recordsFetched)
    try {
      await writeBillingCursor(options.provider, "bank_transactions", period, durableCursor)
      cursor = durableCursor
    } catch (error) {
      status = "failed"
      metrics.errorsCount++
      errors.push(redact(error))
    }
  }

  const errorSummary = errors.length > 0 ? truncateSummary(errors) : null
  await db.update(billingSyncRuns).set({
    status, cursor, ...metrics, errorSummary, finishedAt: new Date().toISOString(),
  }).where(eq(billingSyncRuns.id, runId))

  return { ...base, runId, status, ...metrics, errorSummary }
}

/**
 * Cierra corridas `running` abandonadas. Sin esto el índice único parcial
 * bloquearía para siempre el período de una corrida que murió a medio camino.
 */
async function markStaleRunsAsFailed(
  provider: BillingProviderId,
  scope: BillingSyncScope,
): Promise<void> {
  const threshold = new Date(Date.now() - STALE_RUN_THRESHOLD_MS).toISOString()
  await db.update(billingSyncRuns).set({
    status: "failed",
    errorSummary: "Corrida colgada: no cerró dentro del umbral esperado (proceso interrumpido).",
    finishedAt: new Date().toISOString(),
  }).where(and(
    eq(billingSyncRuns.provider, provider),
    eq(billingSyncRuns.scope, scope),
    eq(billingSyncRuns.status, "running"),
    sql`${billingSyncRuns.startedAt} < ${threshold}`,
  ))
}

function skipped(input: {
  runId: string
  correlationId: string
  provider: BillingProviderId
  scope: BillingSyncScope
  period: string
  dryRun: boolean
  reason: string
  skipReason: NonNullable<BillingSyncResult["skipReason"]>
}): BillingSyncResult {
  return {
    runId: input.runId,
    correlationId: input.correlationId,
    provider: input.provider,
    scope: input.scope,
    period: input.period,
    status: "skipped",
    dryRun: input.dryRun,
    recordsFetched: 0,
    recordsCreated: 0,
    recordsUpdated: 0,
    recordsUnchanged: 0,
    duplicatesDetected: 0,
    conflictsDetected: 0,
    errorsCount: 0,
    errorSummary: input.reason,
    skipReason: input.skipReason,
  }
}

export function currentPeriod(): string {
  return chilePeriod()
}

/** Previous calendar month, crossing year boundaries. */
export function previousBillingPeriod(period: string): string {
  return previousChilePeriod(period)
}

function assertPeriodFormat(period: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new Error(`Período inválido "${period}": se espera "YYYY-MM".`)
  }
}

/**
 * Ninguna corrida puede pedir un período anterior al piso configurado ni un
 * período futuro.
 *
 * El futuro se prohíbe para **todos** los triggers, backfill incluido: un
 * backfill es, por definición, recuperación de historia hacia atrás. Antes la
 * guarda hacía justo lo contrario —sólo el backfill podía pedir el futuro— y
 * dejaba corridas `success` con cero documentos contra meses que no existen
 * (H-13, AUDITORIA_BUGS_2026-08-05.md).
 */
function assertPeriodFloor(period: string): void {
  const { historyFloor } = readSalesSyncConfig()
  if (period < historyFloor) {
    throw new Error(
      `El período ${period} es anterior al piso histórico ${historyFloor}. ` +
      `Ajusta BILLING_HISTORY_FLOOR si realmente necesitas importar más atrás.`,
    )
  }
  if (period > currentPeriod()) {
    throw new Error(`El período ${period} es futuro.`)
  }
}

/**
 * Huella del contenido de un movimiento bancario.
 *
 * Cubre lo que define al movimiento como hecho económico —identificador,
 * fecha y monto—, no su glosa: una corrección de descripción no debe
 * levantarse como conflicto, una de monto o fecha sí. Estable a propósito:
 * cambiar los campos que entran al hash marcaría como divergentes todas las
 * filas ya importadas.
 */
function bankTransactionHash(transaction: { externalId: string; transactionDate: string; amount: number }): string {
  return createHash("sha256")
    .update([transaction.externalId, transaction.transactionDate, transaction.amount.toFixed(2)].join("|"))
    .digest("hex")
}

/** Índice parcial: una sola corrida `running` por (proveedor, alcance, período). */
const SINGLE_ACTIVE_RUN_INDEX = "billing_sync_runs_single_active_unique"

/**
 * ¿El error viene del índice único parcial de corridas activas?
 *
 * Drizzle envuelve el error del driver, así que el SQLSTATE y el nombre de la
 * restricción viven en la cadena de `cause`, no en el error de arriba: hay que
 * recorrerla. Se exige el nombre del índice, no sólo el 23505 — otra violación
 * de unicidad de la misma tabla no significa "ya hay una corrida en curso".
 */
function isSingleActiveRunConflict(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 5; depth++) {
    const candidate = current as { code?: string; constraint?: string; detail?: string; cause?: unknown }
    if (candidate.code === "23505" && candidate.constraint === SINGLE_ACTIVE_RUN_INDEX) return true
    if (typeof candidate.detail === "string" && candidate.detail.includes(SINGLE_ACTIVE_RUN_INDEX)) return true
    current = candidate.cause
  }
  return String((error as { message?: string })?.message ?? "").includes(SINGLE_ACTIVE_RUN_INDEX)
}

/** Resumen acotado: la columna no es un buzón de logs. */
function truncateSummary(errors: string[]): string {
  // Mensajes que solo difieren en números (folio, id) se agrupan: 45 variantes
  // de "Documento N sin RUT…" son UNA línea con conteo, no 45 (UI/UX 2026-08-05, A2).
  const groups = new Map<string, { first: string; count: number }>()
  for (const message of errors) {
    const shape = message.replace(/\d+/g, "#")
    const group = groups.get(shape)
    if (group) group.count += 1
    else groups.set(shape, { first: message, count: 1 })
  }
  const lines = [...groups.values()].map((group) =>
    group.count > 1 ? `${group.first} (y ${group.count - 1} similares)` : group.first,
  )
  const MAX = 2000
  const joined = lines.join(" | ")
  if (joined.length <= MAX) return joined
  return `${joined.slice(0, MAX - 40)}… (+${errors.length} errores en total)`
}

/**
 * Decide what durable cursor remains after a run. A successful run may clear
 * the key; a partial/failed run keeps the page it started (or page 1 when it
 * already consumed the only page) so a later invocation cannot mistake a
 * degraded batch for a completed one.
 */
function resumableCursor(
  status: BillingSyncResult["status"],
  initialCursor: string | null,
  cursor: string | null,
  recordsFetched: number,
): string | null {
  if (status === "success") return cursor
  if (cursor !== null) return cursor
  if (initialCursor !== null) return initialCursor
  return recordsFetched > 0 ? "1" : null
}

function redact(error: unknown): string {
  if (error instanceof DtePortalError) return classifyDteFailure(error).summary
  // ProviderError messages are constructed by our adapters as operational
  // summaries (HTTP status/capability), never raw response bodies.
  if (error instanceof BillingProviderError) return error.message.slice(0, 500)
  // Los errores del propio motor de facturación los construye este módulo: no
  // contienen respuesta externa ni credenciales. Redactarlos no protegía nada y
  // sí borraba el único diagnóstico que queda en `error_summary`, dejando al
  // operador revisando el portal por un conflicto de referencia interna.
  if (error instanceof BillingExternalReferenceConflict || error instanceof BillingExternalReferenceInvalid) {
    return error.message.slice(0, 500)
  }
  // Del resto se conserva el código y la restricción del driver: identifican el
  // índice violado sin exponer los datos de la fila.
  const constraint = driverConstraint(error)
  if (constraint) return `La base de datos rechazó el documento (${constraint}).`
  return "El proveedor no completó la sincronización [detalle técnico omitido]."
}

/** `code` + `constraint` de un error de postgres, si el error los trae. */
function driverConstraint(error: unknown): string | null {
  const candidate = error as { code?: unknown; constraint?: unknown } | null
  if (typeof candidate?.code !== "string" || candidate.code.length === 0) return null
  return typeof candidate.constraint === "string" && candidate.constraint.length > 0
    ? `${candidate.code} ${candidate.constraint}`
    : candidate.code
}
