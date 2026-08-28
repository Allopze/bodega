import { createHash } from "node:crypto"
import { and, desc, eq, gte, lte, ne, notInArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelConsumptionRecords, fuelImportBatches, fuelProviderSyncRuns, systemSettings, users } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { todayInChile, addDaysToPlainDate } from "@/lib/utils"
import { parseConsumptionExcel, type ParsedConsumptionRow } from "@/lib/combustibles/consumption-import"
import { computeBatchTotals } from "@/lib/combustibles/consumption-calculations"
import { plateMatchKey } from "@/lib/combustibles/xlsx-utils"
import { loadVehicleResolver } from "@/lib/combustibles/plate-resolver"
import { saveMeterReadings } from "@/lib/combustibles/meter-readings"
import { AUTOMATED_SOURCES, copecTctSource } from "@/lib/combustibles/fuel-sources"
import { fuelProductIdForLegacy } from "@/lib/combustibles/fuel-products"
import { isOpenPeriod, replaceBatchRecords } from "@/lib/combustibles/open-period"
import { beginFuelProviderSyncRun, finishFuelProviderSyncRun, recordFuelProviderIssues, recordFuelProviderValidation } from "@/lib/combustibles/fuel-provider-ledger"
import { validateProviderRows, type ProviderRowInput } from "@/lib/combustibles/provider-validation"
import { reconcileFuelProviderRun } from "@/lib/combustibles/fuel-reconciliation"
import {
  downloadCopecReports,
} from "@/lib/combustibles/copec-reports"
import { parseTaeReceiptExcel } from "@/lib/combustibles/tae-receipt-import"
import { importTaeReceipts, TaeSupplierMissingError } from "@/lib/combustibles/tae-receipts"

const STATE_KEY = "combustibles.copec.sync"
const START_KEY = "COPEC_SYNC_START_DATE"
const DEFAULT_START = "2020-01-01"

/**
 * `taeCursor` es el cursor del canal TAE, independiente del de TCT.
 *
 * `advanced` mide sólo los informes TCT a propósito (ver el docblock de
 * `importTaeReceiptPeriod`), así que un mes en que TCT entregaba y TAE no hacía
 * avanzar el cursor igual: esas recepciones —la etapa `received` del ciclo
 * físico— no se reintentaban nunca más.
 *
 * Va en la misma fila y no en una clave aparte para que las dos posiciones se
 * guarden en la misma escritura optimista: con dos filas, un fallo entre medio
 * dejaba un canal avanzado y el otro no.
 */
interface SyncState { cursor: string | null; taeCursor: string | null; lastRunAt: string | null; pending: string[]; }

/**
 * Tope de meses TAE atrasados por corrida.
 *
 * `downloadCopecReports` abre un navegador con login POR LLAMADA, y el cron
 * corta a los 5 minutos: ponerse al día de un tirón sobre un histórico largo es
 * un timeout garantizado con el lock tomado. Se recupera de a poco.
 */
const MAX_TAE_CATCHUP_MONTHS = 3

export interface CopecSyncStartOptions {
  currentStart: string
  minimumStart: string
  maximumStart: string
  latestImportedUntil: string | null
}

async function state(): Promise<SyncState & { _version: string }> {
  const row = await db.query.systemSettings.findFirst({ where: eq(systemSettings.key, STATE_KEY) })
  if (!row) return { cursor: null, taeCursor: null, lastRunAt: null, pending: [], _version: "" }
  try { return { ...{ cursor: null, taeCursor: null, lastRunAt: null, pending: [], _version: row.updatedAt ?? "" }, ...JSON.parse(row.value) } }
  catch { return { cursor: null, taeCursor: null, lastRunAt: null, pending: [], _version: "" } }
}

export async function getCopecSyncState(): Promise<{ lastRunAt: string | null; lastRunStatus: string | null; rowsReceived: number; rowsAccepted: number; rowsRejected: number; rowsPending: number; affectedQuantity: number; affectedAmount: number; cursor: string | null; pending: number }> {
  const [s, latestRun] = await Promise.all([
    state(),
    db.query.fuelProviderSyncRuns.findFirst({ where: eq(fuelProviderSyncRuns.provider, "copec"), orderBy: [desc(fuelProviderSyncRuns.startedAt)] }),
  ])
  return {
    lastRunAt: latestRun?.finishedAt ?? latestRun?.startedAt ?? s.lastRunAt,
    lastRunStatus: latestRun?.status ?? null,
    rowsReceived: latestRun?.rowsReceived ?? 0,
    rowsAccepted: latestRun?.rowsAccepted ?? 0,
    rowsRejected: latestRun?.rowsRejected ?? 0,
    rowsPending: latestRun?.rowsPending ?? 0,
    affectedQuantity: latestRun?.affectedQuantity ?? 0,
    affectedAmount: latestRun?.affectedAmount ?? 0,
    cursor: s.cursor,
    pending: latestRun?.rowsPending ?? s.pending.length,
  }
}

/**
 * `expectedVersion` es el `updatedAt` leído por la llamada a `state()` que
 * originó este guardado (`""` si la fila no existía aún). Antes se pisaba a
 * ciegas: dos corridas del cron solapadas —o un cron y un ajuste manual de
 * fecha de inicio— podían leer el mismo estado y la segunda escritura
 * descartaba en silencio el avance de cursor de la primera (CO-026).
 * `setWhere` sólo aplica la actualización si nadie escribió entre medio; si
 * la fila no existía (`expectedVersion === ""`), el INSERT no tiene conflicto
 * y `setWhere` ni se evalúa.
 */
async function saveState(next: SyncState, expectedVersion: string) {
  const value = JSON.stringify(next)
  const now = new Date().toISOString()
  const [result] = await db.insert(systemSettings)
    .values({ key: STATE_KEY, value, updatedAt: now })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value, updatedAt: now },
      setWhere: eq(systemSettings.updatedAt, expectedVersion),
    })
    .returning({ key: systemSettings.key })
  if (!result) {
    throw new Error("El estado de sincronización Copec cambió en otra ejecución. Reintenta desde el estado actual.")
  }
}

// Fecha civil chilena: en UTC (la zona del proceso en producción), entre las
// 21:00 y la medianoche de Chile el 1º del mes ya llegó, y el cálculo del mes
// cerraba un mes de más. Todo lo que dependa del mes en curso —el tope del plan
// y el piso de la fecha de inicio— tiene que pasar por acá, no por `new Date()`.
function today(): string { return todayInChile() }

function addDays(value: string, days: number): string { return addDaysToPlainDate(value, days) }

function firstDayOfMonth(value: string): string {
  return `${value.slice(0, 7)}-01`
}

function shiftMonth(value: string, delta: number): string {
  const date = new Date(`${firstDayOfMonth(value)}T00:00:00.000Z`)
  date.setUTCMonth(date.getUTCMonth() + delta)
  return date.toISOString().slice(0, 10)
}

function nextMonth(value: string): string { return shiftMonth(value, 1) }

function lastDayOfMonth(value: string): string {
  return addDays(nextMonth(value), -1)
}

function isValidIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function startFrom(current: SyncState): string {
  const configuredStart = process.env[START_KEY]?.trim()
  if (isValidIsoDate(current.cursor)) return current.cursor
  if (isValidIsoDate(configuredStart)) return configuredStart
  return DEFAULT_START
}

async function latestActiveImportUntil(): Promise<string | null> {
  const batch = await db.query.fuelImportBatches.findFirst({
    where: ne(fuelImportBatches.estado, "revertido"),
    columns: { periodoHasta: true },
    orderBy: [desc(fuelImportBatches.periodoHasta)],
  })
  return isValidIsoDate(batch?.periodoHasta) ? batch.periodoHasta : null
}

/**
 * `minimumStart` (mes siguiente a la última importación activa) es SOLO la semilla
 * de una instalación sin cursor: sin él, COPEC_SYNC_START_DATE (2020-01-01)
 * barrería años ya cargados a mano. Un cursor explícito siempre manda sobre el
 * piso: "existe un lote posterior" no significa "todo lo anterior está importado",
 * y recortar el cursor contra un lote ajeno saltaba meses completos en silencio
 * (el plan quedaba vacío y la UI decía "no hay meses nuevos"). El doble conteo lo
 * evita el guard por faena+período de `importCopecPeriod`, no este piso.
 */
/**
 * Piso derivado de la última importación activa, recortado al mes en curso.
 *
 * Ahora que el mes abierto se importa y se refresca, un lote suyo dejaría el piso
 * en el mes SIGUIENTE y el plan quedaría vacío: el mes en curso no volvería a
 * sincronizarse nunca.
 */
function minimumStartFrom(latestImportedUntil: string | null): string {
  const floor = latestImportedUntil ? nextMonth(latestImportedUntil) : DEFAULT_START
  const currentMonthStart = firstDayOfMonth(today())
  return floor > currentMonthStart ? currentMonthStart : floor
}

function resolveStart(current: SyncState, minimumStart: string): string {
  const start = startFrom(current)
  return firstDayOfMonth(isValidIsoDate(current.cursor) || start >= minimumStart ? start : minimumStart)
}

/** Hash estable de la proyección TCT. El Excel puede regenerarse con otro
 * nombre o metadata sin que cambie el agregado que se proyecta.
 *
 * `invalidRows` entra al hash aunque no se proyecte: sin él, un archivo que gana
 * una fila inválida sin cambiar ninguna válida salía por el atajo de "hash
 * idéntico, no hay trabajo" y el lote se quedaba con su conteo de filas
 * rechazadas viejo para siempre. */
export function copecProjectionHash(rows: ParsedConsumptionRow[], invalidRows = 0): string {
  return createHash("sha256")
    .update(JSON.stringify({
      invalidRows,
      rows: rows.map((row) => ({
        patente: row.patente,
        tarjetas: row.numeroTarjetas,
        transacciones: row.numeroTransacciones,
        cantidad: row.cantidadUnidad,
        monto: row.monto,
        rendimiento: row.rendimientoPromedio,
      })),
    }))
    .digest("hex")
}

export async function getCopecSyncStartOptions(): Promise<CopecSyncStartOptions> {
  const [current, latestImportedUntil] = await Promise.all([state(), latestActiveImportUntil()])
  const minimumStart = minimumStartFrom(latestImportedUntil)
  return {
    currentStart: resolveStart(current, minimumStart),
    minimumStart,
    maximumStart: firstDayOfMonth(today()),
    latestImportedUntil,
  }
}

export async function setCopecSyncStartDate(startDate: string, expectedStart: string): Promise<CopecSyncStartOptions> {
  if (!isValidIsoDate(startDate)) throw new Error("La fecha de inicio no es válida")
  if (!startDate.endsWith("-01")) throw new Error("Selecciona el primer día del mes desde el que quieres sincronizar")

  const [current, latestImportedUntil] = await Promise.all([state(), latestActiveImportUntil()])
  const minimumStart = minimumStartFrom(latestImportedUntil)
  const currentStart = resolveStart(current, minimumStart)
  if (currentStart !== expectedStart) {
    throw new Error("La sincronización cambió mientras ajustabas la fecha. Actualiza la página e inténtalo nuevamente.")
  }

  const maximumStart = firstDayOfMonth(today())
  // Se permite retroceder por debajo de `minimumStart`: es la única vía para
  // recuperar meses que un lote ajeno dejó fuera del plan. Reimportar no duplica
  // porque `importCopecPeriod` salta las faenas ya importadas por otra fuente.
  if (startDate > maximumStart) {
    throw new Error("La importación automática solo puede comenzar hasta el mes actual.")
  }

  await saveState({ cursor: startDate, taeCursor: current.taeCursor, lastRunAt: current.lastRunAt, pending: current.pending }, current._version)
  return { currentStart: startDate, minimumStart, maximumStart, latestImportedUntil }
}

/**
 * Clave de fila del ledger para una carga TCT.
 *
 * Va por PATENTE y no por índice de fila. El informe TCT es un agregado mensual
 * por patente, así que la patente es su clave natural; el índice de fila, en
 * cambio, es posición en un Excel que Copec REGENERA en cada descarga, y en el
 * informe de detalle es además la fila de la primera transacción de esa patente.
 * Una transacción corregida corría el índice y el ledger ganaba una segunda
 * transacción para la misma patente y mes, con la vieja huérfana para siempre.
 *
 * `from:to:product` es obligatorio: `identity_key` no lleva el período y su
 * índice único es (proveedor, cuenta, identidad), así que sin él dos meses con
 * la misma patente colisionarían y el upsert pisaría el historial.
 *
 * Existe como función porque la cadena se arma en un lado y se RECONSTRUYE en
 * otro para filtrar qué filas entran a la proyección: desincronizarlas deja el
 * lote vacío sin lanzar ningún error.
 */
export function copecSourceRowKey(from: string, to: string, product: string, patente: string): string {
  return `${from}:${to}:${product}:${plateMatchKey(patente)}`
}

export interface CopecSyncPeriod { from: string; to: string }

/** El portal TCT acepta un mes por búsqueda, por eso cada período es un mes calendario. */
export function buildCopecSyncPeriods(from: string, to: string): CopecSyncPeriod[] {
  const firstMonth = firstDayOfMonth(from)
  if (firstMonth > to) return []
  const periods: CopecSyncPeriod[] = []
  for (let cursor = firstMonth; cursor <= to; cursor = nextMonth(cursor)) {
    const end = lastDayOfMonth(cursor)
    if (end > to) break
    periods.push({ from: cursor, to: end })
  }
  return periods
}

/**
 * Inicio del plan considerando el atraso del canal TAE.
 *
 * Los dos canales se piden en el mismo período, así que recuperar un mes TAE es
 * volver a pedir ese mes completo: TCT ya importado sale por el atajo del hash
 * sin escribir nada, y TAE se reintenta. El tope existe porque cada mes es una
 * sesión de navegador con login y el cron corta a los 5 minutos.
 */
function planStartWithTaeCatchup(taeCursor: string | null, tctFrom: string): string {
  if (!isValidIsoDate(taeCursor)) return tctFrom
  const taeFrom = firstDayOfMonth(taeCursor)
  if (taeFrom >= tctFrom) return tctFrom
  const floor = shiftMonth(tctFrom, -MAX_TAE_CATCHUP_MONTHS)
  return taeFrom > floor ? taeFrom : floor
}

export async function getCopecSyncPlan(): Promise<{ from: string; to: string; periods: CopecSyncPeriod[]; pending: number }> {
  const [current, latestImportedUntil] = await Promise.all([state(), latestActiveImportUntil()])
  const minimumStart = minimumStartFrom(latestImportedUntil)
  const from = planStartWithTaeCatchup(current.taeCursor, resolveStart(current, minimumStart))
  // Incluye el mes en curso: su lote se refresca en cada corrida.
  const to = lastDayOfMonth(today())
  return { from, to, periods: buildCopecSyncPeriods(from, to), pending: current.pending.length }
}

interface PeriodSyncResult {
  imported: number
  /** Registros de un período abierto cuyos totales se actualizaron. */
  refreshed: number
  pending: number
  /** Solo informes TCT. El guard de "el portal no entregó nada" se mide con esto:
   *  si un informe TAE contara aquí, una caída de TCT avanzaría el cursor igual. */
  reports: string[]
  unavailable: string[]
  /** Recepciones del canal TAE (etapa `received` del ciclo físico). */
  received: number
  /** Informes TAE que el portal sí entregó. Decide el cursor TAE, igual que
   *  `reports` decide el de TCT. */
  taeReports: number
  /** Tarjetas TAE sin vasija asociada: su combustible no entró al ciclo. */
  unmappedCards: string[]
  rowsReceived: number
  rowsAccepted: number
  rowsRejected: number
  rowsPending: number
  /** Lecturas de odómetro rescatadas del informe de detalle. */
  meterReadings: number
}

async function importCopecPeriod(
  from: string,
  to: string,
  pending: Set<string>,
  importerId?: string,
  runId?: string,
  /** Se va llenando a medida que el ledger escribe, para que una caída a mitad
   *  de camino no cierre la corrida diciendo que no se procesó nada. */
  quality?: { accepted: number; rejected: number; pending: number },
): Promise<PeriodSyncResult> {
  const importerEmail = process.env.COPEC_SYNC_IMPORTER_EMAIL?.trim()
  const configuredImporter = importerId
    ? null
    : importerEmail
    ? await db.query.users.findFirst({ where: and(eq(users.email, importerEmail), eq(users.isActive, true)), columns: { id: true } })
    : null
  const resolvedImporterId = importerId ?? configuredImporter?.id
  if (!resolvedImporterId) throw new Error("No hay un usuario activo para registrar la sincronización Copec. Configura COPEC_SYNC_IMPORTER_EMAIL para la ejecución automática.")

  let imported = 0
  let refreshed = 0
  const reports: string[] = []
  const unavailable: string[] = []
  let rowsReceived = 0
  let rowsAccepted = 0
  let rowsRejected = 0
  let rowsPending = 0
  let meterReadings = 0
  const downloads = await downloadCopecReports(
    (["diesel", "bluemax"] as const).map((product) => ({ product, from, to })),
  )
  for (const download of downloads) {
    const { product } = download
    const productLabel = product === "diesel" ? "Diesel" : "BlueMax"
    const source = copecTctSource(product)
    if (download.unavailable) {
      unavailable.push(productLabel)
      continue
    }
    const { report } = download
    reports.push(`${productLabel}:${report.fileName}`)
    const parsed = await parseConsumptionExcel(report.buffer)
    rowsReceived += parsed.rows.length + parsed.errors.length
    const accountKey = `tct:${product}`
    const validationInputs: ProviderRowInput[] = parsed.rows.map((row) => ({
      provider: "copec",
      accountKey,
      sourceRowKey: copecSourceRowKey(from, to, product, row.patente),
      externalId: null,
      // La PROYECCIÓN es un agregado mensual por patente, así que su evidencia
      // en el ledger se fecha al inicio del período y el rango solicitado sigue
      // siendo la frontera de validación.
      //
      // Ojo: el ARCHIVO sí trae fecha y hora por transacción — el informe de
      // detalle entrega una fila por carga, con odómetro y estación de servicio.
      // Ese nivel no se pierde: viaja a `fuel_meter_readings` por su cuenta (ver
      // `saveMeterReadings` más abajo). Este `from` describe la granularidad de
      // la proyección, no la del archivo.
      occurredAt: from,
      plate: row.patente,
      product,
      quantity: row.cantidadUnidad,
      amount: row.monto,
      payload: row.rawRow,
    }))
    const validation = validateProviderRows(validationInputs, { from, to })
    // Un solo resolutor para el ledger y para la proyección: eran dos bloques
    // idénticos, cada uno con su propia consulta del padrón y de los mappings.
    const resolveVehicle = await loadVehicleResolver({ provider: "copec", sourceAccount: accountKey })
    if (runId) {
      const persistedIssues = await recordFuelProviderIssues(runId, parsed.errors.map((error) => ({
        input: {
          provider: "copec" as const,
          accountKey,
          sourceRowKey: `${from}:${to}:${product}:error:${error.rowIndex}`,
          externalId: null,
          occurredAt: from,
          plate: null,
          product,
          quantity: null,
          amount: null,
          payload: error,
        },
        code: "source_row_invalid",
        message: `${error.field}: ${error.message}`,
      })))
      const persistedRows = await recordFuelProviderValidation(runId, validation, (input) => {
        const vehicle = input.plate ? resolveVehicle(input.plate) : undefined
        return {
          worksiteId: vehicle?.worksiteId,
          vehicleId: vehicle?.id,
          productId: fuelProductIdForLegacy(input.product),
        }
      })
      rowsAccepted += persistedRows.accepted
      rowsRejected += persistedRows.rejected + (persistedIssues.rejected ?? 0)
      rowsPending += persistedRows.pending
      if (quality) {
        quality.accepted += persistedRows.accepted
        quality.rejected += persistedRows.rejected + (persistedIssues.rejected ?? 0)
        quality.pending += persistedRows.pending
      }
    } else {
      rowsAccepted += validation.accepted.length
      rowsRejected += validation.rejected.length + parsed.errors.length
      rowsPending += validation.pending.length
    }
    const groups = new Map<string, ParsedConsumptionRow[]>()
    const acceptedIdentityKeys = new Set(validation.accepted.map((row) => row.identityKey))
    for (const row of parsed.rows) {
      const sourceRowKey = copecSourceRowKey(from, to, product, row.patente)
      if (!acceptedIdentityKeys.has(`row:copec:${accountKey}:${sourceRowKey}`)) continue
      const vehicle = resolveVehicle(row.patente)
      if (!vehicle) { pending.add(row.patente); continue }
      const rows = groups.get(vehicle.worksiteId) ?? []
      rows.push(row); groups.set(vehicle.worksiteId, rows)
    }
    // Las lecturas de odómetro no pertenecen a ningún lote: su identidad es la
    // guía de despacho de la transacción, no (faena, período, producto). Se
    // guardan una vez por archivo y fuera del loop por faena, con upsert, así que
    // una corrección del proveedor en un mes abierto las alcanza igual.
    const savedReadings = await saveMeterReadings(db, "copec_tct", parsed.detail, resolveVehicle)
    meterReadings += savedReadings.saved

    const buildRecords = (rows: ParsedConsumptionRow[], batchId: string, worksiteId: string) =>
      rows.map((row) => ({ id: nanoid(), batchId, worksiteId, vehicleId: resolveVehicle(row.patente)?.id ?? null, patente: row.patente, numeroTarjetas: row.numeroTarjetas, numeroTransacciones: row.numeroTransacciones, cantidadUnidad: row.cantidadUnidad, monto: row.monto, rendimientoPromedio: row.rendimientoPromedio, precioPromedioUnidad: row.cantidadUnidad > 0 ? Math.round(row.monto / row.cantidadUnidad * 100) / 100 : null, periodoDesde: from, periodoHasta: to, fuente: source, rawRow: row.rawRow }))

    // Las filas de `parsed.errors` son del ARCHIVO completo, no por faena: el
    // loop de abajo crea un lote por cada faena del archivo, y antes le sumaba el
    // conteo COMPLETO a cada uno — con 3 faenas en el mismo reporte, el total de
    // filas rechazadas se triplicaba. Se atribuyen al PRIMER grupo del archivo, y
    // en las dos ramas: el flag anterior sólo lo consumía la rama de creación, así
    // que un refresco volvía a multiplicarlas. Por índice y no por "el primero que
    // escriba" para que la atribución no oscile entre corridas cuando un lote sale
    // por el atajo del hash sin escribir nada.
    let groupIndex = 0
    for (const [worksiteId, rows] of groups) {
      const fileErrors = groupIndex++ === 0 ? parsed.errors.length : 0
      // Todo el grupo (dedup por identidad lógica, guard de fuente ajena y el
      // insert que corresponda) bajo un único lock por (faena, período,
      // fuente): antes cada chequeo y cada transacción corrían por separado,
      // así que dos sincronizaciones solapadas (cron + reintento manual, o dos
      // ejecuciones del cron) podían leer "no existe todavía" a la vez y crear
      // el mismo lote dos veces (CO-026). Por hash NO sirve aquí — Copec
      // regenera el Excel en cada descarga.
      const lockKey = `fuel_copec:${worksiteId}:${from}:${to}:${source}`
      const outcome = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`)

        const projectionHash = copecProjectionHash(rows, parsed.errors.length)
        const duplicate = await tx.query.fuelImportBatches.findFirst({ where: and(eq(fuelImportBatches.worksiteId, worksiteId), eq(fuelImportBatches.periodoDesde, from), eq(fuelImportBatches.periodoHasta, to), eq(fuelImportBatches.fuente, source), ne(fuelImportBatches.estado, "revertido")),
          columns: { id: true, hashArchivo: true } })
        if (duplicate) {
          if (duplicate.hashArchivo === projectionHash) return { imported: 0, refreshed: 0 }
          const totals = computeBatchTotals(rows)
          const refresh = await replaceBatchRecords(tx, duplicate.id, buildRecords(rows, duplicate.id, worksiteId))
          await tx.update(fuelImportBatches).set({
            totalFilas: totals.totalFilas + fileErrors,
            filasValidas: totals.totalFilas,
            filasInvalidas: fileErrors,
            totalPatentes: totals.totalPatentes,
            totalTarjetas: totals.totalTarjetas,
            totalTransacciones: totals.totalTransacciones,
            totalCantidad: totals.totalCantidad,
            totalMonto: totals.totalMonto,
            hashArchivo: projectionHash,
            updatedAt: new Date().toISOString(),
          }).where(eq(fuelImportBatches.id, duplicate.id))
          return { imported: refresh.inserted, refreshed: refresh.updated + refresh.removed }
        }
        // El dedup de arriba compara la fuente exacta, así que no ve los lotes
        // importados a mano (fuente 'Copec'): sin este guard, sincronizar un mes ya
        // cargado a mano duplicaría litros y monto de esa faena. Se excluyen TODAS
        // las fuentes automáticas (ver `fuel-sources.ts`): Diésel y BlueMax son lotes
        // separados por diseño y no deben bloquearse entre sí, y un lote de otro
        // proveedor automático en la misma faena y mes es el caso normal —dos
        // contratos de combustible coexistiendo— no una duplicación.
        const foreign = await tx.query.fuelImportBatches.findFirst({
          where: and(
            eq(fuelImportBatches.worksiteId, worksiteId),
            lte(fuelImportBatches.periodoDesde, to),
            gte(fuelImportBatches.periodoHasta, from),
            notInArray(fuelImportBatches.fuente, AUTOMATED_SOURCES),
            ne(fuelImportBatches.estado, "revertido"),
          ),
          columns: { fuente: true },
        })
        if (foreign) return { imported: 0, foreignSource: foreign.fuente }

        const totals = computeBatchTotals(rows)
        const batchId = nanoid()
        await tx.insert(fuelImportBatches).values({ id: batchId, worksiteId, fuente: source, periodoDesde: from, periodoHasta: to, archivoNombre: report.fileName, hashArchivo: projectionHash, estado: "importado", totalFilas: totals.totalFilas + fileErrors, filasValidas: totals.totalFilas, filasInvalidas: fileErrors, totalPatentes: totals.totalPatentes, totalTarjetas: totals.totalTarjetas, totalTransacciones: totals.totalTransacciones, totalCantidad: totals.totalCantidad, totalMonto: totals.totalMonto, importadoPor: resolvedImporterId, notas: "Sincronización mensual automática Copec TCT" })
        await tx.insert(fuelConsumptionRecords).values(buildRecords(rows, batchId, worksiteId))
        return { imported: rows.length }
      })

      if (outcome.foreignSource !== undefined) {
        unavailable.push(`${productLabel}: faena con importación previa (${outcome.foreignSource}) en el período`)
        continue
      }
      imported += outcome.imported
      refreshed += outcome.refreshed ?? 0
    }
  }

  const receipts = await importTaeReceiptPeriod(from, to, resolvedImporterId, unavailable, runId)
  return {
    imported,
    refreshed,
    pending: pending.size,
    reports,
    unavailable,
    ...receipts,
    rowsReceived: rowsReceived + receipts.rowsReceived,
    rowsAccepted: rowsAccepted + receipts.rowsAccepted,
    rowsRejected: rowsRejected + receipts.rowsRejected,
    rowsPending: rowsPending + pending.size + receipts.rowsPending,
    meterReadings,
  }
}

/**
 * Canal TAE: mismo portal y mismo mes, otro "Tipo Producto". Cada fila es una carga
 * de una vasija propia en estación, que es la etapa `received` del ciclo.
 *
 * Sus informes NO se agregan a `reports` a propósito: ese arreglo alimenta el guard
 * que corta el barrido cuando el portal deja de entregar archivos, y debe seguir
 * midiendo únicamente TCT.
 */
async function importTaeReceiptPeriod(
  from: string,
  to: string,
  importerId: string,
  unavailable: string[],
  runId?: string,
): Promise<{ received: number; unmappedCards: string[]; taeReports: number; rowsReceived: number; rowsAccepted: number; rowsRejected: number; rowsPending: number }> {
  const downloads = await downloadCopecReports(
    (["diesel", "bluemax"] as const).map((product) => ({ product, from, to })),
    "TAE",
  )

  let received = 0
  let rowsReceived = 0
  let rowsAccepted = 0
  let rowsRejected = 0
  let rowsPending = 0
  const unmappedCards = new Set<string>()
  let taeReports = 0
  for (const download of downloads) {
    const productLabel = download.product === "diesel" ? "Diesel" : "BlueMax"
    if (download.unavailable) {
      unavailable.push(`TAE ${productLabel}`)
      continue
    }
    const parsed = await parseTaeReceiptExcel(download.report.buffer)
    rowsReceived += parsed.rows.length + parsed.errors.length
    const product = download.product
    const accountKey = `tae:${product}`
    if (runId && parsed.errors.length > 0) {
      await recordFuelProviderIssues(runId, parsed.errors.map((error) => ({
        input: {
          provider: "copec" as const,
          accountKey,
          sourceRowKey: `${from}:${to}:${product}:error:${error.rowIndex}`,
          externalId: null,
          occurredAt: from,
          plate: null,
          product,
          quantity: null,
          amount: null,
          payload: error,
        },
        code: "source_row_invalid",
        message: `${error.field}: ${error.message}`,
      })))
    }
    rowsRejected += parsed.errors.length
    let outcome
    try {
      outcome = await importTaeReceipts(parsed.rows, importerId)
    } catch (error) {
      // Sin proveedor en el catálogo no hay nada que importar, pero tampoco es
      // una falla de la corrida: se reporta como no disponible para que el
      // cursor TAE no avance y el mes se reintente cuando exista la ficha.
      if (!(error instanceof TaeSupplierMissingError)) throw error
      unavailable.push(`TAE ${productLabel}: ${error.message}`)
      continue
    }
    // Recién acá: el contador decide si avanza el cursor TAE, así que tiene que
    // significar "este informe entró", no "el portal me lo entregó".
    taeReports++
    received += outcome.inserted
    rowsAccepted += outcome.inserted
    for (const card of outcome.unmappedCards) unmappedCards.add(card)
    const unmappedCardSet = new Set(outcome.unmappedCards)
    const unmappedRows = parsed.rows.filter((row) => unmappedCardSet.has(row.cardNumber))
    rowsPending += unmappedRows.length
    if (runId && unmappedRows.length > 0) {
      await recordFuelProviderIssues(runId, unmappedRows.map((row) => ({
        input: {
          provider: "copec" as const,
          accountKey,
          sourceRowKey: row.documentNumber,
          externalId: row.documentNumber,
          occurredAt: row.occurredAt,
          plate: row.cardNumber,
          product,
          quantity: row.liters,
          amount: row.amount,
          payload: row.rawRow,
        },
        code: "unmapped_tae_card",
        message: `La tarjeta TAE ${row.cardNumber} no tiene estanque activo para ${productLabel}`,
      })), "pending")
    }
  }
  return { received, unmappedCards: [...unmappedCards].sort(), taeReports, rowsReceived, rowsAccepted, rowsRejected, rowsPending }
}

export async function syncCopecReportPeriod(period: CopecSyncPeriod, importerId?: string): Promise<PeriodSyncResult> {
  const current = await state()
  const pending = new Set(current.pending)
  const run = await beginFuelProviderSyncRun({
    provider: "copec",
    trigger: importerId ? "manual" : "cron",
    requestedFrom: period.from,
    requestedTo: period.to,
    actorUserId: importerId,
  })
  let runFinished = false
  let receivedRows = 0
  // Fuera del try: si el período muere después de escribir el ledger, cerrar la
  // corrida con las métricas en cero borraba de la bitácora el trabajo hecho.
  const quality = { accepted: 0, rejected: 0, pending: 0 }
  try {
    const result = await importCopecPeriod(period.from, period.to, pending, importerId, run.id, quality)
    receivedRows = result.rowsReceived
    // Solo avanzamos el cursor si el portal entregó al menos un archivo. Un período
    // sin NINGUNA descarga (todas las tarjetas "no disponible") no hace avanzar el
    // cursor; un mes abierto queda listo para refrescarse en la próxima corrida.
    const advanced = result.reports.length > 0 && !isOpenPeriod(period.to)
    // El canal TAE avanza por su cuenta y con el mismo criterio: si el portal no
    // entregó su informe, este mes queda pendiente de reintento aunque TCT haya
    // funcionado. Nunca retrocede: un mes de recuperación no puede tirar hacia
    // atrás el cursor de un mes posterior ya importado.
    const taeAdvanced = result.taeReports > 0 && !isOpenPeriod(period.to)
    const taeCursor = taeAdvanced ? addDays(period.to, 1) : period.from
    let stateError: string | null = null
    try {
      // Ningún cursor retrocede: recuperar un mes atrasado hace que el plan
      // vuelva a pedir un período viejo, y guardar su posición tal cual tiraría
      // hacia atrás el canal que ya iba más adelante.
      const forward = (previous: string | null, next: string) => (previous && previous > next ? previous : next)
      await saveState({
        cursor: forward(current.cursor, advanced ? addDays(period.to, 1) : period.from),
        taeCursor: forward(current.taeCursor, taeCursor),
        lastRunAt: new Date().toISOString(),
        pending: [...pending].sort(),
      }, current._version)
    } catch (err) {
      stateError = err instanceof Error ? err.message : "No fue posible guardar el estado Copec"
      console.error("[copec-sync] saveState failed, cursor may be stale on next run", stateError)
    }
    // La conciliación es un modelo derivado que se calcula DESPUÉS de importar:
    // si falla, los lotes ya están commiteados, así que se reporta como parcial
    // con el motivo en vez de marcar la corrida como fallida.
    const reconciliationError = await reconcileFuelProviderRun(run.id).then(
      () => null,
      (error: unknown) => (error instanceof Error ? error.message : "No fue posible conciliar la corrida"),
    )
    if (reconciliationError) console.error("[copec-sync] conciliación incompleta", reconciliationError)

    await finishFuelProviderSyncRun(run.id, {
      status: stateError || reconciliationError || result.rowsRejected > 0 || result.rowsPending > 0 || result.unavailable.length > 0 ? "partial" : "success",
      receivedFrom: period.from,
      receivedTo: period.to,
      files: result.reports.length,
      rowsReceived: result.rowsReceived,
      rowsAccepted: result.rowsAccepted,
      rowsRejected: result.rowsRejected,
      rowsPending: result.rowsPending,
      rowsReprocessed: result.refreshed,
      error: stateError ?? reconciliationError,
    })
    runFinished = true
    return result
  } catch (error) {
    if (!runFinished) {
      try {
        await finishFuelProviderSyncRun(run.id, {
          status: "failed",
          receivedFrom: period.from,
          receivedTo: period.to,
          rowsReceived: receivedRows,
          rowsAccepted: quality.accepted,
          rowsRejected: quality.rejected,
          rowsPending: quality.pending,
          error: error instanceof Error ? error.message : "Error desconocido en la sincronización Copec",
        })
      } catch (finishError) {
        console.error("[copec-sync] no fue posible cerrar la corrida durable", finishError instanceof Error ? finishError.message : "error desconocido")
      }
    }
    throw error
  }
}

export async function syncCopecReports(): Promise<{ from: string; to: string; imported: number; refreshed: number; received: number; pending: number; reports: string[]; unavailable: string[]; unmappedCards: string[]; meterReadings: number }> {
  const plan = await getCopecSyncPlan()
  let imported = 0
  let refreshed = 0
  let received = 0
  let meterReadings = 0
  const reports: string[] = []
  const unavailable: string[] = []
  const unmappedCards = new Set<string>()
  let pending = plan.pending
  for (const period of plan.periods) {
    const result = await syncCopecReportPeriod(period)
    imported += result.imported
    refreshed += result.refreshed
    received += result.received
    meterReadings += result.meterReadings
    for (const card of result.unmappedCards) unmappedCards.add(card)
    pending = result.pending
    reports.push(...result.reports)
    unavailable.push(...result.unavailable.map((product) => `${period.from} a ${period.to} (${product})`))
    // Un período que no descargó nada indica portal/credenciales rotos. Se corta
    // el barrido y se falla ruidosamente en vez de avanzar el cursor por todo el
    // histórico importando cero (el bug que dejó la sync "al día" con la tabla vacía).
    if (result.reports.length === 0) {
      // El mes en curso puede no estar disponible todavía en el portal, o no
      // tener consumo aún. Eso no es señal de portal roto: se corta el barrido
      // sin fallar. Un mes CERRADO sin archivo sí es sospechoso y sigue fallando.
      if (isOpenPeriod(period.to)) break
      throw new Error(`Copec no entregó ningún archivo para el período ${period.from} a ${period.to}. Revisa credenciales/portal, o ajusta la fecha de inicio si ese tramo no tiene consumos. Se importaron ${imported} registros antes de detenerse.`)
    }
  }
  return { from: plan.from, to: plan.to, imported, refreshed, received, pending, reports, unavailable, unmappedCards: [...unmappedCards].sort(), meterReadings }
}
