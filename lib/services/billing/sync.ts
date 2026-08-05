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
import { readSalesSyncConfig } from "./config"
import { upsertProviderInvoice } from "./invoices"
import { assertCapability, getBillingProvider, isProviderEnabled } from "./providers"
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
  const correlationId = nanoid(12)

  assertPeriodFormat(period)
  assertPeriodFloor(period, trigger)

  if (!isProviderEnabled(options.provider)) {
    return skipped({
      runId: "", correlationId, provider: options.provider, scope: options.scope, period, dryRun,
      reason: "El proveedor está deshabilitado por configuración.",
    })
  }

  const provider = getBillingProvider(options.provider)
  if (!(await provider.isConfigured())) {
    return skipped({
      runId: "", correlationId, provider: options.provider, scope: options.scope, period, dryRun,
      reason: "El proveedor no está configurado en este servidor.",
    })
  }

  await markStaleRunsAsFailed(options.provider, options.scope)

  const runId = nanoid()
  try {
    await db.insert(billingSyncRuns).values({
      id: runId,
      provider: options.provider,
      scope: options.scope,
      trigger,
      status: "running",
      dryRun,
      periodFrom: period,
      periodTo: period,
      cursor: options.cursor ?? null,
      correlationId,
      triggeredBy: options.triggeredBy ?? null,
    })
  } catch {
    // El índice único parcial rechazó la inserción: ya hay una corrida activa
    // para este (proveedor, alcance, período).
    return skipped({
      runId: "", correlationId, provider: options.provider, scope: options.scope, period, dryRun,
      reason: "Ya hay una sincronización en curso para este período.",
    })
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
  let cursor: string | null = options.cursor ?? null

  try {
    const seenExternalIds = new Set<string>()
    let pages = 0

    do {
      const page = await fetchPage(provider, options.scope, { period, cursor })
      pages++
      metrics.recordsFetched += page.items.length

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

      cursor = page.nextCursor
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

  const errorSummary = errors.length > 0 ? truncateSummary(errors) : null

  await db.update(billingSyncRuns).set({
    status,
    cursor,
    ...metrics,
    errorSummary,
    finishedAt: new Date().toISOString(),
  }).where(eq(billingSyncRuns.id, runId))

  return {
    runId, correlationId, provider: options.provider, scope: options.scope, period,
    status, dryRun, ...metrics, errorSummary,
  }
}

/* ── Interno ─────────────────────────────────────────────────────────────── */

async function fetchPage(
  provider: BillingProvider,
  scope: BillingSyncScope,
  query: { period: string; cursor: string | null },
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
}): Promise<BillingSyncResult> {
  const period = options.period ?? currentPeriod()
  const correlationId = nanoid(12)
  assertPeriodFormat(period)
  assertPeriodFloor(period, options.trigger ?? "manual")

  const base = {
    runId: "", correlationId, provider: options.provider,
    scope: "bank_transactions" as BillingSyncScope, period, dryRun: false,
  }

  if (!isProviderEnabled(options.provider)) {
    return skipped({ ...base, reason: "El proveedor está deshabilitado por configuración." })
  }
  const provider = getBillingProvider(options.provider)
  if (!provider.capabilities.canListBankTransactions) {
    return skipped({ ...base, reason: `${provider.label} no entrega movimientos bancarios.` })
  }
  if (!(await provider.isConfigured())) {
    return skipped({ ...base, reason: "El proveedor no está configurado en este servidor." })
  }

  const runId = nanoid()
  try {
    await db.insert(billingSyncRuns).values({
      id: runId, provider: options.provider, scope: "bank_transactions",
      trigger: options.trigger ?? "manual", status: "running", dryRun: false,
      periodFrom: period, periodTo: period, correlationId,
      triggeredBy: options.triggeredBy ?? null,
    })
  } catch {
    return skipped({ ...base, reason: "Ya hay una sincronización en curso para este período." })
  }

  const metrics = {
    recordsFetched: 0, recordsCreated: 0, recordsUpdated: 0, recordsUnchanged: 0,
    duplicatesDetected: 0, conflictsDetected: 0, errorsCount: 0,
  }
  const errors: string[] = []
  let status: BillingSyncResult["status"] = "success"
  let cursor: string | null = null
  let pages = 0

  try {
    do {
      const page = await provider.listBankTransactions!({ period, cursor })
      pages++
      metrics.recordsFetched += page.items.length

      for (const transaction of page.items) {
        try {
          const hash = createHash("sha256")
            .update([transaction.externalId, transaction.transactionDate, transaction.amount.toFixed(2)].join("|"))
            .digest("hex")

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
          if (result.length > 0) metrics.recordsCreated++
          else metrics.recordsUnchanged++
        } catch (error) {
          metrics.errorsCount++
          errors.push(redact(error))
        }
      }

      cursor = page.nextCursor
      if (pages >= MAX_PAGES_PER_RUN && cursor) {
        errors.push(`Se alcanzó el tope de ${MAX_PAGES_PER_RUN} páginas; la corrida queda reanudable por cursor.`)
        status = "partial"
        break
      }
    } while (cursor)

    if (metrics.errorsCount > 0) {
      status = metrics.errorsCount === metrics.recordsFetched ? "failed" : "partial"
    }
  } catch (error) {
    status = "failed"
    metrics.errorsCount++
    errors.push(redact(error))
    logger.error(`[billing/sync ${correlationId}] cartolas fallaron`, { message: redact(error) })
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
  }
}

export function currentPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

function assertPeriodFormat(period: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new Error(`Período inválido "${period}": se espera "YYYY-MM".`)
  }
}

/**
 * Un backfill no puede ir más atrás que el piso configurado, y una corrida
 * normal no puede pedir un período anterior al piso por error de tipeo.
 */
function assertPeriodFloor(period: string, trigger: string): void {
  const { historyFloor } = readSalesSyncConfig()
  if (period < historyFloor) {
    throw new Error(
      `El período ${period} es anterior al piso histórico ${historyFloor}. ` +
      `Ajusta BILLING_HISTORY_FLOOR si realmente necesitas importar más atrás.`,
    )
  }
  if (period > currentPeriod() && trigger !== "backfill") {
    throw new Error(`El período ${period} es futuro.`)
  }
}

/** Resumen acotado: la columna no es un buzón de logs. */
function truncateSummary(errors: string[]): string {
  const MAX = 2000
  const joined = errors.join(" | ")
  if (joined.length <= MAX) return joined
  return `${joined.slice(0, MAX - 40)}… (+${errors.length} errores en total)`
}

function redact(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return /clave|rut_usr|password|token|authorization/i.test(message)
    ? "Error del proveedor [detalle omitido por contener credenciales]"
    : message
}
