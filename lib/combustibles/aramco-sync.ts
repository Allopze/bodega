/**
 * Sincronización de consumos de Aramco Fleet.
 *
 * A diferencia de `copec-sync.ts` esta sincronización no lleva cursor de meses:
 * el histórico completo de la cuenta entra en una sola llamada a la API, así que
 * la idempotencia la da el `transactionId`. La corrida y sus métricas sí quedan
 * en el ledger. El cron y el botón manual llaman la misma función.
 *
 * Incluye el **mes en curso**, para dar visibilidad del consumo del día. El
 * agregado cambia cuando el proveedor incorpora, corrige o retira cargas, así
 * que el lote se RECONSTRUYE en cada corrida cuya identidad de contenido
 * cambió. El reemplazo conserva vínculos manuales de vehículo y elimina de la
 * proyección las patentes que ya no vienen en la fuente.
 *
 * Conserva de Copec una decisión: **un lote por (faena, mes, producto)**, porque
 * `fuel_consumption_records` no tiene columna de producto y viaja en `fuente`.
 *
 * La faena se deriva del vehículo, buscando la patente en `fuel_vehicles`. Las
 * patentes que no están en el catálogo NO se pierden: se devuelven como
 * pendientes para el flujo de vinculación que ya existe.
 */

import { createHash } from "node:crypto"
import { and, eq, gte, lte, ne, notInArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelConsumptionRecords, fuelImportBatches, users } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { todayInChile } from "@/lib/utils"
import { calcPrecioPromedioUnidad, computeBatchTotals } from "@/lib/combustibles/consumption-calculations"
import { normalizePlate } from "@/lib/combustibles/xlsx-utils"
import { loadVehicleResolver } from "@/lib/combustibles/plate-resolver"
import { AUTOMATED_SOURCES, aramcoSourceForProduct } from "@/lib/combustibles/fuel-sources"
import { fuelProductIdForLegacy } from "@/lib/combustibles/fuel-products"
import { replaceBatchRecords } from "@/lib/combustibles/open-period"
import { beginFuelProviderSyncRun, finishFuelProviderSyncRun, recordFuelProviderValidation } from "@/lib/combustibles/fuel-provider-ledger"
import { validateProviderRows, type ProviderRowInput } from "@/lib/combustibles/provider-validation"
import { readAramcoConfig } from "@/lib/combustibles/aramco-settings"
import {
  authenticateAramco,
  fetchAramcoMovements,
  type AramcoMovement,
} from "@/lib/combustibles/aramco-client"

/** Ventana por defecto del cron. Con ~1 transacción al mes sobra de lejos, y
 *  cubre el caso de que Aramco cargue una transacción con retraso. */
const DEFAULT_LOOKBACK_MONTHS = 4

/**
 * Techo de rendimiento plausible en km/L. El portal calcula `vehicleConsumption`
 * a partir del odómetro que el conductor tipea en el surtidor, y en el histórico
 * real 48 de 154 transacciones dan valores absurdos (hasta 785 km/L) porque la
 * lectura previa está desfasada. Un rendimiento inventado envenena los
 * dashboards y el detector de anomalías, así que sobre este techo se guarda 0
 * —«sin dato»—, que es lo mismo que hace el parser de Copec con su guard
 * `performance > 0`. El detalle crudo queda en `rawRow` para auditar.
 */
const MAX_PLAUSIBLE_KM_PER_LITER = 25

/**
 * `type` y no `interface` a propósito: la ruta de cron lo pasa como
 * `Record<string, unknown>` al armar la respuesta, y un `interface` no tiene
 * index signature implícita, así que TS lo rechaza.
 */
export type AramcoSyncResult = {
  /** Registros de consumo insertados. */
  imported: number
  /** Registros de un período abierto cuyos totales se actualizaron. */
  refreshed: number
  /** Lotes nuevos creados. */
  batches: number
  /** Transacciones leídas de la API. */
  transactions: number
  /** Métricas de calidad durable de la corrida. */
  rowsAccepted: number
  rowsRejected: number
  rowsPending: number
  /** Patentes que no están en `fuel_vehicles` (no se importó su consumo). */
  pendingPlates: string[]
  /**
   * Grupos saltados por tener una carga previa de otra fuente.
   *
   * NO llamar a este campo `skipped`: la ruta de cron distingue una corrida
   * saltada por lock con `"skipped" in outcome`, y un campo con ese nombre en
   * el resultado hacía que una corrida exitosa se reportara como conflicto 409.
   */
  skippedGroups: { periodo: string; source: string; foreignSource: string }[]
  from: string
  to: string
}

/* ── Fechas: aritmética sobre strings, sin Date ───────────────────────────── */

/**
 * `transactionDate` viene como hora local de pared (`2026-08-18T07:49:32`, sin
 * zona), así que el mes se saca por slice y no por `Date`: convertir a `Date` y
 * volver es justo el camino por el que una carga del día 1 a las 00:30 termina
 * contada en el mes anterior.
 */
function monthOf(transactionDate: string): string {
  return transactionDate.slice(0, 7)
}

function monthBounds(month: string): { from: string; to: string } {
  const year = Number(month.slice(0, 4))
  const monthNumber = Number(month.slice(5, 7))
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` }
}

function shiftMonth(month: string, delta: number): string {
  const year = Number(month.slice(0, 4))
  const monthNumber = Number(month.slice(5, 7))
  const total = year * 12 + (monthNumber - 1) + delta
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`
}

/* ── Agregación ──────────────────────────────────────────────────────────── */

interface AggregatedRow {
  patente: string
  numeroTarjetas: number
  numeroTransacciones: number
  cantidadUnidad: number
  monto: number
  rendimientoPromedio: number
  transactions: AramcoMovement[]
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** km/L de una transacción, o null si el odómetro no da un número creíble. */
function plausiblePerformance(movement: AramcoMovement): number | null {
  const current = Number(movement.vehicleOdometer ?? Number.NaN)
  const previous = Number(movement.vehiclePreviousOdometer ?? Number.NaN)
  const quantity = Number(movement.quantity ?? 0)
  if (!Number.isFinite(current) || !Number.isFinite(previous) || quantity <= 0) return null
  const performance = (current - previous) / quantity
  if (performance <= 0 || performance > MAX_PLAUSIBLE_KM_PER_LITER) return null
  return performance
}

/**
 * Agrupa las transacciones de un (mes, producto) por patente.
 *
 * `monto` sale de `amountToPay` —lo que efectivamente se cobra, ya con el
 * descuento aplicado— y no de `originalAmount`, que es precio de lista. Es lo
 * que hace comparable el total con el `Monto ($)` del reporte de Copec, y lo que
 * hace que `precioPromedioUnidad` coincida con el `unitAmountToPay` del portal.
 */
function aggregateByPlate(movements: AramcoMovement[]): AggregatedRow[] {
  const groups = new Map<string, {
    cards: Set<string>
    transactions: AramcoMovement[]
    quantity: number
    amount: number
    weightedPerformance: number
    performanceQuantity: number
  }>()

  for (const movement of movements) {
    // `normalizePlate` y no `.trim().toUpperCase()`: Aramco entrega la patente
    // con espacios ("RW YH 93") y el resto del módulo guarda el canon sin ellos.
    // Guardarla cruda hacía que el mismo camión contara como dos patentes en el
    // dashboard —que agrupa por la columna— y que el filtro `?patente=RWYH93`
    // que arma la ficha de flota no encontrara ninguna de sus cargas.
    const plate = normalizePlate(movement.vehicleRegistrationPlate ?? "")
    if (!plate) continue
    const group = groups.get(plate) ?? {
      cards: new Set<string>(),
      transactions: [],
      quantity: 0,
      amount: 0,
      weightedPerformance: 0,
      performanceQuantity: 0,
    }
    const quantity = Number(movement.quantity ?? 0)
    const card = (movement.cardNumber ?? "").trim()
    if (card) group.cards.add(card)
    group.transactions.push(movement)
    group.quantity += quantity
    group.amount += Number(movement.amountToPay ?? 0)
    const performance = plausiblePerformance(movement)
    if (performance !== null) {
      group.weightedPerformance += performance * quantity
      group.performanceQuantity += quantity
    }
    groups.set(plate, group)
  }

  return [...groups.entries()].map(([patente, group]) => ({
    patente,
    numeroTarjetas: group.cards.size,
    numeroTransacciones: group.transactions.length,
    cantidadUnidad: round(group.quantity, 4),
    monto: round(group.amount, 2),
    rendimientoPromedio: group.performanceQuantity > 0
      ? round(group.weightedPerformance / group.performanceQuantity, 2)
      : 0,
    transactions: group.transactions,
  }))
}

/** Identidad de contenido del grupo, incluyendo campos que el proveedor puede
 * corregir sin cambiar el `transactionId` (cantidad, monto, patente o fecha). */
export function aramcoProjectionHash(movements: AramcoMovement[]): string {
  const rows = movements
    .map((movement) => ({
      transactionId: movement.transactionId,
      transactionDate: movement.transactionDate,
      vehicleRegistrationPlate: movement.vehicleRegistrationPlate,
      productName: movement.productName,
      quantity: movement.quantity,
      amountToPay: movement.amountToPay,
    }))
    .sort((left, right) => left.transactionId - right.transactionId)
  return createHash("sha256").update(JSON.stringify(rows), "utf8").digest("hex")
}

/* ── Sincronización ──────────────────────────────────────────────────────── */

async function resolveImporterId(importerId?: string): Promise<string> {
  if (importerId) return importerId
  const email = process.env.ARAMCO_SYNC_IMPORTER_EMAIL?.trim()
  const configured = email
    ? await db.query.users.findFirst({
        where: and(eq(users.email, email), eq(users.isActive, true)),
        columns: { id: true },
      })
    : null
  if (!configured?.id) {
    throw new Error("No hay un usuario activo para registrar la sincronización Aramco. Configura ARAMCO_SYNC_IMPORTER_EMAIL para la ejecución automática.")
  }
  return configured.id
}

export interface SyncAramcoOptions {
  /** Primer mes a considerar (`YYYY-MM-DD`). Por defecto, 4 meses atrás. */
  from?: string
  /** Último mes a considerar. Se recorta al mes civil en curso. */
  to?: string
  /** Usuario que dispara la sincronización manual. Sin él se usa el del cron. */
  importerId?: string
  trigger?: "manual" | "cron" | "reprocess"
  correlationId?: string
}

/**
 * Trae las transacciones de Aramco y las deja como lotes de consumo.
 *
 * Es idempotente: cada respuesta externa entra primero al ledger por identidad
 * y la proyección mensual se reconstruye sólo cuando cambió su hash.
 */
export async function syncAramco(options: SyncAramcoOptions = {}): Promise<AramcoSyncResult> {
  const config = await readAramcoConfig()
  if (!config.hasCredentials) {
    throw new Error("Faltan las credenciales de Aramco. Configúralas en Combustibles → Importar.")
  }
  const importerId = await resolveImporterId(options.importerId)

  const today = todayInChile()
  const currentMonth = today.slice(0, 7)
  const firstMonth = options.from?.slice(0, 7) ?? shiftMonth(currentMonth, -DEFAULT_LOOKBACK_MONTHS)
  const lastMonth = options.to ? [options.to.slice(0, 7), currentMonth].sort()[0]! : currentMonth

  const from = monthBounds(firstMonth).from
  const to = monthBounds(lastMonth).to
  const run = await beginFuelProviderSyncRun({
    provider: "aramco",
    trigger: options.trigger ?? (options.importerId ? "manual" : "cron"),
    requestedFrom: from,
    requestedTo: to,
    actorUserId: importerId,
    correlationId: options.correlationId,
  })
  let runFinished = false
  const empty: AramcoSyncResult = { imported: 0, refreshed: 0, batches: 0, transactions: 0, rowsAccepted: 0, rowsRejected: 0, rowsPending: 0, pendingPlates: [], skippedGroups: [], from, to }
  if (firstMonth > lastMonth) {
    await finishFuelProviderSyncRun(run.id, { status: "success", receivedFrom: from, receivedTo: to, rowsReceived: 0, rowsAccepted: 0, rowsRejected: 0, rowsPending: 0 })
    runFinished = true
    return empty
  }

  let receivedRows = 0
  try {
    const session = await authenticateAramco(config.documentNumber, config.password)
    const movements = await fetchAramcoMovements(session, from, to)
    receivedRows = movements.length
    if (movements.length === 0) {
      await finishFuelProviderSyncRun(run.id, { status: "success", receivedFrom: from, receivedTo: to, rowsReceived: 0, rowsAccepted: 0, rowsRejected: 0, rowsPending: 0 })
      runFinished = true
      return empty
    }

    const accountKey = "fleet"
    const validationInputs: ProviderRowInput[] = movements.map((movement) => ({
      provider: "aramco",
      accountKey,
      sourceRowKey: String(movement.transactionId),
      externalId: movement.transactionId,
      occurredAt: movement.transactionDate,
      plate: movement.vehicleRegistrationPlate,
      product: movement.productName,
      quantity: movement.quantity,
      amount: movement.amountToPay,
      payload: movement,
    }))
    const validation = validateProviderRows(validationInputs, { from, to })

    // Matching por clave normalizada, no por igualdad exacta: Aramco entrega la
    // patente con espacios ("SZ GB 72") y el catálogo la guarda con o sin guion.
    const resolveVehicle = await loadVehicleResolver({ provider: "aramco", sourceAccount: accountKey })
    const persisted = await recordFuelProviderValidation(run.id, validation, (input) => {
      const vehicle = input.plate ? resolveVehicle(input.plate) : undefined
      return {
        worksiteId: vehicle?.worksiteId,
        vehicleId: vehicle?.id,
        productId: input.product ? fuelProductIdForLegacy(input.product) : null,
      }
    })
    const acceptedIdentityKeys = new Set(validation.accepted.map((row) => row.identityKey))

    // (mes, fuente) -> (faena -> transacciones). El grupo es la unidad de lote.
    const groups = new Map<string, Map<string, AramcoMovement[]>>()
    const pendingPlates = new Set<string>()
    for (const movement of movements) {
      if (!acceptedIdentityKeys.has(`external:${movement.transactionId}`)) continue
      // Sin normalizar a propósito: `pendingPlates` va a un toast para que el
      // operador busque la patente en el portal de Aramco, y ahí sirve el texto
      // tal como Aramco lo entrega. La resolución de vehículo ya normaliza sola
      // con `plateMatchKey`, así que el formato de acá no decide nada.
      const plate = (movement.vehicleRegistrationPlate ?? "").trim()
      const vehicle = plate ? resolveVehicle(plate) : undefined
      if (!vehicle) {
        if (plate) pendingPlates.add(plate)
        continue
      }
      const key = `${monthOf(movement.transactionDate)}|${aramcoSourceForProduct(movement.productName)}`
      const byWorksite = groups.get(key) ?? new Map<string, AramcoMovement[]>()
      const rows = byWorksite.get(vehicle.worksiteId) ?? []
      rows.push(movement)
      byWorksite.set(vehicle.worksiteId, rows)
      groups.set(key, byWorksite)
    }

    const result: AramcoSyncResult = {
      imported: 0,
      refreshed: 0,
      batches: 0,
      transactions: movements.length,
      rowsAccepted: persisted.accepted,
      rowsRejected: persisted.rejected,
      rowsPending: persisted.pending,
      pendingPlates: [...pendingPlates],
      skippedGroups: [],
      from,
      to,
    }

  for (const [key, byWorksite] of groups) {
    const [month, source] = key.split("|") as [string, string]
    const period = monthBounds(month)

    for (const [worksiteId, worksiteMovements] of byWorksite) {
      const rows = aggregateByPlate(worksiteMovements)
      if (rows.length === 0) continue
      const hash = aramcoProjectionHash(worksiteMovements)

      const buildRecords = (subset: AggregatedRow[], batchId: string) => subset.map((row) => ({
        id: nanoid(),
        batchId,
        worksiteId,
        vehicleId: resolveVehicle(row.patente)?.id ?? null,
        patente: row.patente,
        numeroTarjetas: row.numeroTarjetas,
        numeroTransacciones: row.numeroTransacciones,
        cantidadUnidad: row.cantidadUnidad,
        monto: row.monto,
        rendimientoPromedio: row.rendimientoPromedio,
        precioPromedioUnidad: calcPrecioPromedioUnidad(row.monto, row.cantidadUnidad),
        periodoDesde: period.from,
        periodoHasta: period.to,
        fuente: source,
        rawRow: { detalle: row.transactions },
      }))

      // Todo el grupo bajo un único lock por (faena, período, fuente): dos
      // ejecuciones solapadas (cron + botón manual) podían leer «no existe
      // todavía» a la vez y crear el mismo lote dos veces. Es el mismo CO-026
      // que se corrigió en Copec.
      const lockKey = `fuel_aramco:${worksiteId}:${period.from}:${period.to}:${source}`
      const outcome = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`)

        const duplicate = await tx.query.fuelImportBatches.findFirst({
          where: and(
            eq(fuelImportBatches.worksiteId, worksiteId),
            eq(fuelImportBatches.periodoDesde, period.from),
            eq(fuelImportBatches.periodoHasta, period.to),
            eq(fuelImportBatches.fuente, source),
            ne(fuelImportBatches.estado, "revertido"),
          ),
          // `hashArchivo` identifica la proyección completa, no sólo sus totales:
          // dos composiciones distintas pueden tener la misma suma.
          columns: {
            id: true,
            hashArchivo: true,
            totalFilas: true,
            totalPatentes: true,
            totalTarjetas: true,
            totalTransacciones: true,
            totalCantidad: true,
            totalMonto: true,
          },
        })
        if (duplicate) {
          // No hay trabajo si la fuente es idéntica. La comparación por hash
          // también aplica a meses cerrados: Aramco puede corregir o retirar
          // cargas históricas y la proyección debe seguir siendo reconstruible.
          if (duplicate.hashArchivo === hash) return { imported: 0, refreshed: 0, created: false }

          const totals = computeBatchTotals(rows)
          const replacement = await replaceBatchRecords(tx, duplicate.id, buildRecords(rows, duplicate.id))
          await tx.update(fuelImportBatches).set({
            totalFilas: totals.totalFilas,
            filasValidas: totals.totalFilas,
            totalPatentes: totals.totalPatentes,
            totalTarjetas: totals.totalTarjetas,
            totalTransacciones: totals.totalTransacciones,
            totalCantidad: totals.totalCantidad,
            totalMonto: totals.totalMonto,
            hashArchivo: hash,
            updatedAt: new Date().toISOString(),
          }).where(eq(fuelImportBatches.id, duplicate.id))
          return {
            imported: replacement.inserted,
            refreshed: replacement.updated + replacement.removed,
            created: false,
          }
        }

        // El dedup de arriba compara la fuente exacta, así que no ve una carga
        // manual del mismo mes. Se excluyen todas las fuentes automáticas: un
        // lote de Copec en la misma faena y mes es normal, no una duplicación.
        const foreign = await tx.query.fuelImportBatches.findFirst({
          where: and(
            eq(fuelImportBatches.worksiteId, worksiteId),
            lte(fuelImportBatches.periodoDesde, period.to),
            gte(fuelImportBatches.periodoHasta, period.from),
            notInArray(fuelImportBatches.fuente, AUTOMATED_SOURCES),
            ne(fuelImportBatches.estado, "revertido"),
          ),
          columns: { fuente: true },
        })
        if (foreign) return { imported: 0, created: false, foreignSource: foreign.fuente ?? "sin fuente" }

        const totals = computeBatchTotals(rows)
        const batchId = nanoid()
        await tx.insert(fuelImportBatches).values({
          id: batchId,
          worksiteId,
          fuente: source,
          periodoDesde: period.from,
          periodoHasta: period.to,
          // No hay archivo: el "nombre" identifica el origen y el período, y el
          // hash es la identidad de contenido de las transacciones que componen
          // el lote, no sólo una marca de que el período fue consultado.
          archivoNombre: `aramco-${source.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${month}.json`,
          hashArchivo: hash,
          estado: "importado",
          totalFilas: totals.totalFilas,
          filasValidas: totals.totalFilas,
          filasInvalidas: 0,
          totalPatentes: totals.totalPatentes,
          totalTarjetas: totals.totalTarjetas,
          totalTransacciones: totals.totalTransacciones,
          totalCantidad: totals.totalCantidad,
          totalMonto: totals.totalMonto,
          importadoPor: importerId,
          notas: "Sincronización automática Aramco Fleet",
        })
        await tx.insert(fuelConsumptionRecords).values(buildRecords(rows, batchId))
        return { imported: rows.length, created: true }
      })

      result.imported += outcome.imported
      result.refreshed += outcome.refreshed ?? 0
      if (outcome.created) result.batches += 1
      if (outcome.foreignSource) {
        result.skippedGroups.push({ periodo: month, source, foreignSource: outcome.foreignSource })
      }
    }
  }

    await finishFuelProviderSyncRun(run.id, {
      status: result.rowsRejected > 0 || result.rowsPending > 0 ? "partial" : "success",
      receivedFrom: from,
      receivedTo: to,
      rowsReceived: result.transactions,
      rowsAccepted: result.rowsAccepted,
      rowsRejected: result.rowsRejected,
      rowsPending: result.rowsPending,
      rowsReprocessed: result.refreshed,
    })
    runFinished = true
    return result
  } catch (error) {
    if (!runFinished) {
      try {
        await finishFuelProviderSyncRun(run.id, {
          status: "failed",
          receivedFrom: from,
          receivedTo: to,
          rowsReceived: receivedRows,
          rowsAccepted: 0,
          rowsRejected: 0,
          rowsPending: 0,
          error: error instanceof Error ? error.message : "Error desconocido en la sincronización Aramco",
        })
      } catch (finishError) {
        console.error("[aramco-sync] no fue posible cerrar la corrida durable", finishError instanceof Error ? finishError.message : "error desconocido")
      }
    }
    throw error
  }
}
