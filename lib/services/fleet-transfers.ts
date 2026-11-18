import { and, asc, desc, eq, gte, inArray, lte, notInArray, or, sql, type SQL } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  fleetGpsAlerts,
  fleetGpsLatestPositions,
  fleetGpsPositionHistory,
  fleetGpsTrips,
  fleetTransferItems,
  fleetTransfers,
  fuelAnomalyCases,
  fuelConsumptionRecords,
  fuelEquipmentTypes,
  fuelImportBatches,
  fuelMeterReadings,
  fuelVehicleWorksiteIntervals as stays,
  fuelVehicles,
  mantEquipmentProfiles,
  mantWorkOrders,
  users,
  worksites,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { isoTextDaySql } from "@/lib/combustibles/control/queries/field-filters"
import { AUTOMATED_SOURCES } from "@/lib/combustibles/fuel-sources"
import { moveProviderMappingsWithVehicleTx } from "@/lib/combustibles/provider-mappings"
import {
  formatTransferFolio,
  MAX_VEHICLES_PER_TRANSFER,
  transferDateError,
  transferDateWindow,
  transferTextErrors,
} from "@/lib/fleet/transfer-rules"
import { nanoid } from "@/lib/id"
import { writeEquipmentHistory } from "@/lib/services/mantencion/equipment-history"
import { addDaysToPlainDate, chileDayStartInstant, formatDate, todayInChile } from "@/lib/utils"

/**
 * Traslado de equipos entre faenas: el ÚNICO código que cambia
 * `fuel_vehicles.worksite_id` de un equipo existente. La base lo hace cumplir
 * (trigger diferido `FLEET_STAY_INVARIANT`): un `UPDATE` directo de la faena
 * falla al confirmar. Todo se mueve en la misma transacción: estadía, faena del
 * equipo, asignaciones de proveedor, filas GPS y casos de anomalía posteriores a
 * la fecha, historial de Mantención y auditoría.
 */

export interface TransferActor {
  userId: string
  email: string | null
  scope: string[] | "all"
}

export interface TransferInput {
  toWorksiteId: string
  /** Fecha civil `YYYY-MM-DD`: el día del traslado ya cuenta en la faena nueva. */
  effectiveDate: string
  reason: string
  authorizedBy: string
  vehicleIds: string[]
}

export interface TransferCandidate {
  vehicleId: string
  code: string
  plate: string
  typeName: string
  brand: string | null
  worksiteId: string
  worksiteName: string
  /** Inicio de la estadía abierta; nulo = «desde siempre». */
  stayStartedOn: string | null
  openWorkOrderFolio: string | null
  providerMappingCount: number
}

type TransferFieldKey = "toWorksiteId" | "effectiveDate" | "reason" | "authorizedBy" | "vehicleIds"

export type TransferOutcome =
  | {
      ok: true
      message: string
      data: {
        transferId: string
        folio: string
        moved: number
        copecRecheckFrom: string | null
        manualImportNotice: string | null
      }
    }
  | {
      ok: false
      message: string
      fieldErrors?: Partial<Record<TransferFieldKey, string>>
      rowErrors?: Record<string, string>
    }

export interface TransferListRow {
  id: string
  folio: string
  effectiveDate: string
  toWorksiteId: string
  toWorksiteName: string
  items: Array<{ vehicleId: string; code: string; plate: string; fromWorksiteId: string; fromWorksiteName: string }>
  reason: string
  authorizedBy: string
  createdByName: string | null
  createdAt: string
  voidedAt: string | null
  voidReason: string | null
  /**
   * Lo que el servidor aceptaría anular para quien mira: no anulado, cada equipo sigue
   * en la estadía que abrió este traslado, la fecha está dentro de la ventana
   * (`transferDateWindow`) y quien mira administra el destino y todos los orígenes.
   */
  voidable: boolean
}

/** Único texto con que se rechaza cualquier camino que intente cambiar la faena de un equipo sin trasladarlo. */
export const USE_TRANSFER_MESSAGE = "Para cambiar de faena usa «Trasladar equipos»."

const STALE_MESSAGE = "El equipo cambió de faena en otra sesión. Recarga e inténtalo de nuevo."
const MIN_VOID_REASON_LENGTH = 10

/** Los mensajes de Postgres viajan en `error.cause` (Drizzle envuelve el error original). */
export function isFleetStayInvariantError(error: unknown): boolean {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if (current.message.includes("FLEET_STAY_INVARIANT")) return true
  }
  return false
}

function inScope(scope: string[] | "all", worksiteId: string): boolean {
  return scope === "all" || scope.includes(worksiteId)
}

function vehicleLabel(vehicle: { code: string | null; plate: string }): string {
  return vehicle.code?.trim() || vehicle.plate
}

/** Día 1 del mes de `date` si ese mes ya terminó respecto de `today`; si no, `null`. */
function recheckFrom(date: string, today: string): string | null {
  return date < `${today.slice(0, 7)}-01` ? `${date.slice(0, 7)}-01` : null
}

/** Re-estampa con `worksiteId` las filas GPS del equipo desde la medianoche chilena de `date`. */
async function restampGps(tx: Tx, vehicleId: string, worksiteId: string, date: string): Promise<void> {
  const since = chileDayStartInstant(date)
  await tx.update(fleetGpsPositionHistory).set({ worksiteId })
    .where(and(eq(fleetGpsPositionHistory.vehicleId, vehicleId), gte(fleetGpsPositionHistory.occurredAt, since)))
  await tx.update(fleetGpsTrips).set({ worksiteId })
    .where(and(eq(fleetGpsTrips.vehicleId, vehicleId), gte(fleetGpsTrips.startedAt, since)))
  await tx.update(fleetGpsAlerts).set({ worksiteId })
    .where(and(eq(fleetGpsAlerts.vehicleId, vehicleId), gte(fleetGpsAlerts.occurredAt, since)))
  // La última posición es el estado actual del equipo, no un hecho fechado.
  await tx.update(fleetGpsLatestPositions).set({ worksiteId }).where(eq(fleetGpsLatestPositions.vehicleId, vehicleId))
}

/**
 * Re-estampa con `worksiteId` los casos de anomalía del equipo que tomaron SU faena
 * (no la de un registro propio) y son de `date` en adelante:
 *
 * - los de una lectura de medidor (`fuel_meter_reading`): el detector los estampa
 *   con la estadía del día chileno de la lectura, y ese día es el que se compara;
 * - los de «consumo durante inactividad» (`fuel_vehicle`): llevan la faena del
 *   equipo el día en que se detectaron, que va al final de su referencia
 *   (`<vehículo>:AAAA-MM-DD`); una referencia con otra forma no se toca.
 *
 * Los de TAE, cargas, consumos y registros de operación llevan la faena de su
 * registro, que un traslado no mueve.
 */
async function restampAnomalyCases(tx: Tx, vehicleId: string, worksiteId: string, date: string): Promise<void> {
  const detectedOn = sql`right(${fuelAnomalyCases.referenceEntityId}, 10)`
  await tx.update(fuelAnomalyCases).set({ worksiteId, updatedAt: new Date().toISOString() })
    .where(and(
      eq(fuelAnomalyCases.vehicleId, vehicleId),
      or(
        and(
          eq(fuelAnomalyCases.referenceEntityType, "fuel_meter_reading"),
          sql`exists (
            select 1 from ${fuelMeterReadings}
            where ${fuelMeterReadings.id} = ${fuelAnomalyCases.referenceEntityId}
              and to_char(${isoTextDaySql(fuelMeterReadings.occurredAt)}, 'YYYY-MM-DD') >= ${date}
          )`,
        ),
        and(
          eq(fuelAnomalyCases.referenceEntityType, "fuel_vehicle"),
          sql`${fuelAnomalyCases.referenceEntityId} = ${fuelAnomalyCases.vehicleId} || ':' || ${detectedOn}`,
          sql`${detectedOn} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`,
          sql`${detectedOn} >= ${date}`,
        ),
      ),
    ))
}

/** Equipos (de `vehicleIds`) que tienen ficha de Mantención: sólo ellos llevan historial. */
async function vehiclesWithMantProfile(tx: Tx, vehicleIds: string[]): Promise<Set<string>> {
  if (vehicleIds.length === 0) return new Set()
  const rows = await tx.select({ vehicleId: mantEquipmentProfiles.vehicleId })
    .from(mantEquipmentProfiles).where(inArray(mantEquipmentProfiles.vehicleId, vehicleIds))
  return new Set(rows.map((row) => row.vehicleId))
}

/** Candidatos a trasladar: equipos activos cuya faena actual está en el alcance. */
export async function listTransferCandidates(scope: string[] | "all"): Promise<TransferCandidate[]> {
  if (scope !== "all" && scope.length === 0) return []
  const rows = await db.select({
    vehicleId: fuelVehicles.id,
    code: fuelVehicles.code,
    plate: fuelVehicles.plate,
    typeName: fuelEquipmentTypes.name,
    brand: fuelVehicles.brand,
    worksiteId: fuelVehicles.worksiteId,
    worksiteName: worksites.name,
    stayStartedOn: sql<string | null>`(
      select s.started_on from ${stays} s where s.vehicle_id = ${fuelVehicles.id} and s.ended_on is null limit 1
    )`,
    openWorkOrderFolio: sql<string | null>`(
      select w.folio from ${mantWorkOrders} w
      where w.vehicle_id = ${fuelVehicles.id} and w.status not in ('cerrada', 'anulada')
      order by w.created_at desc limit 1
    )`,
    providerMappingCount: sql<number>`(
      select count(*)::int from fuel_provider_mappings m where m.vehicle_id = ${fuelVehicles.id} and m.is_active
    )`,
  })
    .from(fuelVehicles)
    .innerJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId))
    .innerJoin(fuelEquipmentTypes, eq(fuelEquipmentTypes.id, fuelVehicles.equipmentTypeId))
    .where(and(
      eq(fuelVehicles.isActive, true),
      scope === "all" ? undefined : inArray(fuelVehicles.worksiteId, scope),
    ))
    .orderBy(asc(worksites.name), asc(fuelVehicles.code), asc(fuelVehicles.plate))
  return rows.map((row) => ({ ...row, code: row.code ?? "" }))
}

function validateHeader(
  actor: TransferActor,
  input: TransferInput,
  today: string,
  destination: { id: string; isActive: boolean } | undefined,
): Partial<Record<TransferFieldKey, string>> {
  const errors: Partial<Record<TransferFieldKey, string>> = { ...transferTextErrors(input) }
  if (!destination || !destination.isActive) errors.toWorksiteId = "Esa faena no existe o está inactiva."
  else if (!inScope(actor.scope, destination.id)) errors.toWorksiteId = "No administras la faena de destino."
  const dateError = transferDateError(input.effectiveDate, today, null)
  if (dateError) errors.effectiveDate = dateError
  if (input.vehicleIds.length === 0) errors.vehicleIds = "Marca al menos un equipo."
  else if (input.vehicleIds.length > MAX_VEHICLES_PER_TRANSFER) errors.vehicleIds = `Máximo ${MAX_VEHICLES_PER_TRANSFER} equipos por traslado.`
  return errors
}

/**
 * Registra el traslado dentro de la transacción de quien llama. Todo o nada: si
 * algún dato o equipo no sirve, no escribe nada y dice cuál y por qué.
 */
export async function transferVehiclesTx(
  tx: Tx,
  actor: TransferActor,
  input: TransferInput,
  today: string,
): Promise<TransferOutcome> {
  const vehicleIds = [...new Set(input.vehicleIds)]
  const date = input.effectiveDate
  const reason = input.reason.trim()
  const authorizedBy = input.authorizedBy.trim()

  const [destination] = await tx.select({ id: worksites.id, name: worksites.name, isActive: worksites.isActive })
    .from(worksites).where(eq(worksites.id, input.toWorksiteId))
  const fieldErrors = validateHeader(actor, { ...input, vehicleIds }, today, destination)
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, message: "Revisa los datos del traslado.", fieldErrors }
  }
  if (!destination) throw new Error("unreachable: destino validado")

  // Las filas se bloquean antes de leer la estadía: una segunda persona con la lista vieja
  // espera aquí y ve el estado nuevo, no el que tenía su pantalla.
  const vehicles = await tx.select({
    id: fuelVehicles.id,
    code: fuelVehicles.code,
    plate: fuelVehicles.plate,
    isActive: fuelVehicles.isActive,
    worksiteId: fuelVehicles.worksiteId,
    worksiteName: worksites.name,
  })
    .from(fuelVehicles)
    .innerJoin(worksites, eq(worksites.id, fuelVehicles.worksiteId))
    .where(inArray(fuelVehicles.id, vehicleIds))
    .orderBy(asc(fuelVehicles.id))
    .for("update", { of: fuelVehicles })
  const openStays = await tx.select({
    id: stays.id,
    vehicleId: stays.vehicleId,
    startedOn: stays.startedOn,
  }).from(stays).where(and(inArray(stays.vehicleId, vehicleIds), sql`${stays.endedOn} IS NULL`))
  const openStayByVehicle = new Map(openStays.map((stay) => [stay.vehicleId, stay]))
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]))

  const rowErrors: Record<string, string> = {}
  for (const vehicleId of vehicleIds) {
    const vehicle = vehicleById.get(vehicleId)
    if (!vehicle) { rowErrors[vehicleId] = "El equipo no existe."; continue }
    if (!vehicle.isActive) { rowErrors[vehicleId] = "Está dado de baja."; continue }
    if (!inScope(actor.scope, vehicle.worksiteId)) {
      rowErrors[vehicleId] = `Es de ${vehicle.worksiteName}, una faena que no administras.`
      continue
    }
    if (vehicle.worksiteId === destination.id) { rowErrors[vehicleId] = `Ya está en ${destination.name}.`; continue }
    const stay = openStayByVehicle.get(vehicleId)
    if (!stay) { rowErrors[vehicleId] = "No tiene una estadía abierta."; continue }
    const dateError = transferDateError(date, today, stay.startedOn)
    if (dateError) rowErrors[vehicleId] = dateError
  }
  if (Object.keys(rowErrors).length > 0) {
    return { ok: false, message: "Revisa los equipos marcados.", rowErrors }
  }

  // El folio se calcula bajo candado: dos traslados simultáneos no pueden tomar el mismo número.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('fleet_transfer_folio'))`)
  const [totalRow] = await tx.select({ total: sql<number>`count(*)::int` }).from(fleetTransfers)
  const folio = formatTransferFolio((totalRow?.total ?? 0) + 1)
  const transferId = nanoid()

  await tx.insert(fleetTransfers).values({
    id: transferId,
    folio,
    effectiveDate: date,
    toWorksiteId: destination.id,
    reason,
    authorizedBy,
    createdBy: actor.userId,
  })
  await tx.insert(fleetTransferItems).values(vehicles.map((vehicle) => ({
    id: nanoid(),
    transferId,
    vehicleId: vehicle.id,
    fromWorksiteId: vehicle.worksiteId,
  })))

  const withProfile = await vehiclesWithMantProfile(tx, vehicleIds)
  const nowIso = new Date().toISOString()
  for (const vehicle of vehicles) {
    const openStay = openStayByVehicle.get(vehicle.id)!
    await tx.update(stays).set({ endedOn: addDaysToPlainDate(date, -1) }).where(eq(stays.id, openStay.id))
    await tx.insert(stays).values({
      id: nanoid(),
      vehicleId: vehicle.id,
      worksiteId: destination.id,
      startedOn: date,
      source: "traslado",
      transferId,
    })
    await tx.update(fuelVehicles).set({ worksiteId: destination.id, updatedAt: nowIso }).where(eq(fuelVehicles.id, vehicle.id))
    await moveProviderMappingsWithVehicleTx(tx, {
      vehicleId: vehicle.id,
      worksiteId: destination.id,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      effectiveFrom: date,
    })
    await restampGps(tx, vehicle.id, destination.id, date)
    await restampAnomalyCases(tx, vehicle.id, destination.id, date)
    if (withProfile.has(vehicle.id)) {
      await writeEquipmentHistory(tx, {
        vehicleId: vehicle.id,
        action: "update",
        summary: `Trasladado a ${destination.name} desde el ${formatDate(date)} (${folio})`,
        changes: { Faena: { from: vehicle.worksiteName, to: destination.name } },
        userId: actor.userId,
      })
    }
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.email ?? undefined,
      action: "update",
      entityType: "fuel_vehicle",
      entityId: vehicle.id,
      entityCode: vehicleLabel(vehicle),
      oldState: { worksiteId: vehicle.worksiteId },
      newState: { worksiteId: destination.id, effectiveDate: date, transferId, folio },
      reason,
      worksiteId: destination.id,
    }, tx)
  }
  await recordAudit({
    userId: actor.userId,
    userEmail: actor.email ?? undefined,
    action: "create",
    entityType: "fleet_transfer",
    entityId: transferId,
    entityCode: folio,
    newState: { effectiveDate: date, toWorksiteId: destination.id, authorizedBy, vehicleIds },
    reason,
    worksiteId: destination.id,
  }, tx)

  const manualImportNotice = await manualImportNoticeFor(tx, vehicles, date)
  const n = vehicles.length
  return {
    ok: true,
    message: `${folio}: ${n} ${n === 1 ? "equipo pasa" : "equipos pasan"} a ${destination.name} desde el ${formatDate(date)}.`,
    data: { transferId, folio, moved: n, copecRecheckFrom: recheckFrom(date, today), manualImportNotice },
  }
}

/**
 * Consumos importados a mano (lotes que no son de un proveedor automático: Copec ni los
 * legados de Aramco, `AUTOMATED_SOURCES`) del equipo en su faena de origen y posteriores
 * a la fecha: el traslado no los mueve y alguien debe revisarlos. `null` si no hay.
 */
async function manualImportNoticeFor(
  tx: Tx,
  vehicles: Array<{ id: string; worksiteId: string; worksiteName: string }>,
  date: string,
): Promise<string | null> {
  const rows = await tx.select({ vehicleId: fuelConsumptionRecords.vehicleId, worksiteId: fuelConsumptionRecords.worksiteId })
    .from(fuelConsumptionRecords)
    .innerJoin(fuelImportBatches, eq(fuelImportBatches.id, fuelConsumptionRecords.batchId))
    .where(and(
      inArray(fuelConsumptionRecords.vehicleId, vehicles.map((vehicle) => vehicle.id)),
      gte(fuelConsumptionRecords.periodoHasta, date),
      notInArray(fuelImportBatches.fuente, AUTOMATED_SOURCES),
    ))
  const originByVehicle = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]))
  const origins = new Set<string>()
  let count = 0
  for (const row of rows) {
    const vehicle = row.vehicleId ? originByVehicle.get(row.vehicleId) : undefined
    if (!vehicle || row.worksiteId !== vehicle.worksiteId) continue
    count += 1
    origins.add(vehicle.worksiteName)
  }
  if (count === 0) return null
  const where = [...origins].sort().join(", ")
  return count === 1
    ? `1 consumo importado a mano posterior al ${formatDate(date)} sigue en ${where}: revisa ese lote.`
    : `${count} consumos importados a mano posteriores al ${formatDate(date)} siguen en ${where}: revisa esos lotes.`
}

/** El aviso a Copec es de mejor esfuerzo: nunca tumba un traslado ya confirmado. */
async function requestCopecRecheckBestEffort(month: string | null): Promise<void> {
  if (!month) return
  try {
    const { requestCopecRecheckFrom } = await import("@/lib/combustibles/copec-sync")
    await requestCopecRecheckFrom(month)
  } catch (error) {
    console.error("[fleet-transfers] no se pudo pedir la revisión de Copec", error)
  }
}

export async function transferVehicles(
  actor: TransferActor,
  input: TransferInput,
  today: string = todayInChile(),
): Promise<TransferOutcome> {
  let outcome: TransferOutcome
  try {
    outcome = await db.transaction((tx) => transferVehiclesTx(tx, actor, input, today))
  } catch (error) {
    if (isFleetStayInvariantError(error)) return { ok: false, message: STALE_MESSAGE }
    throw error
  }
  if (outcome.ok) await requestCopecRecheckBestEffort(outcome.data.copecRecheckFrom)
  return outcome
}

/**
 * Anula un traslado: borra las estadías que abrió, reabre las anteriores y devuelve
 * faena, asignaciones de proveedor y GPS. Sólo si cada equipo sigue en la estadía que
 * abrió este traslado; para corregir una fecha, se anula y se registra de nuevo.
 */
export async function voidTransfer(
  actor: TransferActor,
  input: { transferId: string; reason: string },
  today: string = todayInChile(),
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const reason = input.reason.trim()
  if (reason.length < MIN_VOID_REASON_LENGTH) {
    return { ok: false, message: `Explica el motivo en al menos ${MIN_VOID_REASON_LENGTH} caracteres.` }
  }
  let outcome: { ok: true; message: string; copecRecheckFrom: string | null } | { ok: false; message: string }
  try {
    outcome = await db.transaction((tx) => voidTransferTx(tx, actor, input.transferId, reason, today))
  } catch (error) {
    if (isFleetStayInvariantError(error)) return { ok: false, message: STALE_MESSAGE }
    throw error
  }
  if (!outcome.ok) return outcome
  await requestCopecRecheckBestEffort(outcome.copecRecheckFrom)
  return { ok: true, message: outcome.message }
}

/**
 * Un traslado anterior a la ventana de registro (`transferDateWindow`) no se anula por
 * pantalla: deshacerlo reescribiría meses ya revisados y no se podría volver a registrar
 * con su fecha. Se corrige con el script de reconstrucción, con aprobación del usuario.
 */
function voidWindowError(effectiveDate: string, today: string): string | null {
  const { min } = transferDateWindow(today)
  return effectiveDate < min
    ? `No se puede anular: el traslado es anterior al ${formatDate(min)}. Pide la corrección con el script de reconstrucción.`
    : null
}

async function voidTransferTx(
  tx: Tx,
  actor: TransferActor,
  transferId: string,
  reason: string,
  today: string,
): Promise<{ ok: true; message: string; copecRecheckFrom: string | null } | { ok: false; message: string }> {
  const [transfer] = await tx.select().from(fleetTransfers).where(eq(fleetTransfers.id, transferId)).for("update")
  if (!transfer) return { ok: false, message: "Ese traslado no existe." }
  if (transfer.voidedAt) return { ok: false, message: "Ese traslado ya está anulado." }

  const items = await tx.select({ vehicleId: fleetTransferItems.vehicleId, fromWorksiteId: fleetTransferItems.fromWorksiteId })
    .from(fleetTransferItems).where(eq(fleetTransferItems.transferId, transfer.id))
  if (!inScope(actor.scope, transfer.toWorksiteId) || items.some((item) => !inScope(actor.scope, item.fromWorksiteId))) {
    return { ok: false, message: "No administras todas las faenas de este traslado." }
  }
  const windowError = voidWindowError(transfer.effectiveDate, today)
  if (windowError) return { ok: false, message: windowError }

  const vehicleIds = items.map((item) => item.vehicleId)
  const vehicles = await tx.select({ id: fuelVehicles.id, code: fuelVehicles.code, plate: fuelVehicles.plate })
    .from(fuelVehicles).where(inArray(fuelVehicles.id, vehicleIds)).orderBy(asc(fuelVehicles.id)).for("update")
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]))
  const allStays = await tx.select({
    id: stays.id,
    vehicleId: stays.vehicleId,
    startedOn: stays.startedOn,
    endedOn: stays.endedOn,
    transferId: stays.transferId,
    folio: fleetTransfers.folio,
  }).from(stays).leftJoin(fleetTransfers, eq(fleetTransfers.id, stays.transferId))
    .where(inArray(stays.vehicleId, vehicleIds))

  const staysByVehicle = new Map<string, typeof allStays>()
  for (const stay of allStays) staysByVehicle.set(stay.vehicleId, [...(staysByVehicle.get(stay.vehicleId) ?? []), stay])

  // Primero se verifica todo: o se deshace el traslado entero o no se toca nada.
  const ownStayByVehicle = new Map<string, (typeof allStays)[number]>()
  for (const item of items) {
    const vehicleStays = staysByVehicle.get(item.vehicleId) ?? []
    const own = vehicleStays.find((stay) => stay.transferId === transfer.id)
    const vehicle = vehicleById.get(item.vehicleId)
    if (!own || !vehicle) return { ok: false, message: "El recorrido del equipo no coincide con el traslado." }
    if (own.endedOn !== null) {
      const next = vehicleStays
        .filter((stay) => stay.startedOn !== null && own.startedOn !== null && stay.startedOn > own.startedOn)
        .sort((a, b) => (a.startedOn! < b.startedOn! ? -1 : 1))[0]
      return {
        ok: false,
        message: next?.folio
          ? `No se puede anular: ${vehicleLabel(vehicle)} se trasladó de nuevo después (${next.folio}).`
          : `No se puede anular: ${vehicleLabel(vehicle)} cambió de faena después.`,
      }
    }
    ownStayByVehicle.set(item.vehicleId, own)
  }

  const [destination] = await tx.select({ name: worksites.name }).from(worksites).where(eq(worksites.id, transfer.toWorksiteId))
  const worksiteNames = new Map(
    (await tx.select({ id: worksites.id, name: worksites.name }).from(worksites)
      .where(inArray(worksites.id, [...new Set(items.map((item) => item.fromWorksiteId))]))).map((row) => [row.id, row.name]),
  )
  const toName = destination?.name ?? transfer.toWorksiteId
  const withProfile = await vehiclesWithMantProfile(tx, vehicleIds)
  const nowIso = new Date().toISOString()
  const previousEnd = addDaysToPlainDate(transfer.effectiveDate, -1)

  for (const item of items) {
    const own = ownStayByVehicle.get(item.vehicleId)!
    const vehicle = vehicleById.get(item.vehicleId)!
    const fromName = worksiteNames.get(item.fromWorksiteId) ?? item.fromWorksiteId
    // La abierta se borra antes de reabrir la anterior: el índice único admite una sola abierta.
    await tx.delete(stays).where(eq(stays.id, own.id))
    await tx.update(stays).set({ endedOn: null })
      .where(and(eq(stays.vehicleId, item.vehicleId), eq(stays.endedOn, previousEnd)))
    await tx.update(fuelVehicles).set({ worksiteId: item.fromWorksiteId, updatedAt: nowIso }).where(eq(fuelVehicles.id, item.vehicleId))
    await moveProviderMappingsWithVehicleTx(tx, {
      vehicleId: item.vehicleId,
      worksiteId: item.fromWorksiteId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      effectiveFrom: transfer.effectiveDate,
    })
    await restampGps(tx, item.vehicleId, item.fromWorksiteId, transfer.effectiveDate)
    await restampAnomalyCases(tx, item.vehicleId, item.fromWorksiteId, transfer.effectiveDate)
    if (withProfile.has(item.vehicleId)) {
      await writeEquipmentHistory(tx, {
        vehicleId: item.vehicleId,
        action: "update",
        summary: `Traslado ${transfer.folio} anulado: vuelve a ${fromName}`,
        changes: { Faena: { from: toName, to: fromName } },
        userId: actor.userId,
      })
    }
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.email ?? undefined,
      action: "update",
      entityType: "fuel_vehicle",
      entityId: item.vehicleId,
      entityCode: vehicleLabel(vehicle),
      oldState: { worksiteId: transfer.toWorksiteId },
      newState: { worksiteId: item.fromWorksiteId, voidedTransferId: transfer.id, folio: transfer.folio },
      reason,
      worksiteId: item.fromWorksiteId,
    }, tx)
  }

  await tx.update(fleetTransfers)
    .set({ voidedAt: nowIso, voidedBy: actor.userId, voidReason: reason })
    .where(eq(fleetTransfers.id, transfer.id))
  // La plataforma no tiene una acción "void" de auditoría: las anulaciones usan "cancel".
  await recordAudit({
    userId: actor.userId,
    userEmail: actor.email ?? undefined,
    action: "cancel",
    entityType: "fleet_transfer",
    entityId: transfer.id,
    entityCode: transfer.folio,
    oldState: { effectiveDate: transfer.effectiveDate, toWorksiteId: transfer.toWorksiteId },
    newState: { voided: true },
    reason,
    worksiteId: transfer.toWorksiteId,
  }, tx)

  return {
    ok: true,
    message: `${transfer.folio} anulado.`,
    copecRecheckFrom: recheckFrom(transfer.effectiveDate, today),
  }
}

/**
 * Traslados visibles para el alcance (destino u origen en el alcance). De cada uno, quien
 * no administra el destino ve sólo los equipos que salieron de sus faenas: códigos,
 * patentes y orígenes de faenas ajenas no se muestran ni se exportan.
 */
export async function listTransfers(
  scope: string[] | "all",
  filters: { from: string; to: string; worksiteId?: string },
  today: string = todayInChile(),
): Promise<TransferListRow[]> {
  if (scope !== "all" && scope.length === 0) return []
  const itemsOf = (extra: SQL) => sql`exists (
    select 1 from ${fleetTransferItems} i where i.transfer_id = ${fleetTransfers.id} and ${extra}
  )`
  const conditions: Array<SQL | undefined> = [
    gte(fleetTransfers.effectiveDate, filters.from),
    lte(fleetTransfers.effectiveDate, filters.to),
  ]
  if (scope !== "all") {
    conditions.push(or(
      inArray(fleetTransfers.toWorksiteId, scope),
      itemsOf(sql`i.from_worksite_id in (${sql.join(scope.map((id) => sql`${id}`), sql`, `)})`),
    ))
  }
  if (filters.worksiteId) {
    conditions.push(or(
      eq(fleetTransfers.toWorksiteId, filters.worksiteId),
      itemsOf(sql`i.from_worksite_id = ${filters.worksiteId}`),
    ))
  }
  const transfers = await db.select({
    id: fleetTransfers.id,
    folio: fleetTransfers.folio,
    effectiveDate: fleetTransfers.effectiveDate,
    toWorksiteId: fleetTransfers.toWorksiteId,
    toWorksiteName: worksites.name,
    reason: fleetTransfers.reason,
    authorizedBy: fleetTransfers.authorizedBy,
    createdByName: users.name,
    createdAt: fleetTransfers.createdAt,
    voidedAt: fleetTransfers.voidedAt,
    voidReason: fleetTransfers.voidReason,
  })
    .from(fleetTransfers)
    .innerJoin(worksites, eq(worksites.id, fleetTransfers.toWorksiteId))
    .leftJoin(users, eq(users.id, fleetTransfers.createdBy))
    .where(and(...conditions))
    .orderBy(desc(fleetTransfers.effectiveDate), desc(fleetTransfers.createdAt), desc(fleetTransfers.folio))
  if (transfers.length === 0) return []

  const transferIds = transfers.map((transfer) => transfer.id)
  const itemRows = await db.select({
    transferId: fleetTransferItems.transferId,
    vehicleId: fleetTransferItems.vehicleId,
    code: fuelVehicles.code,
    plate: fuelVehicles.plate,
    fromWorksiteId: fleetTransferItems.fromWorksiteId,
    fromWorksiteName: worksites.name,
  })
    .from(fleetTransferItems)
    .innerJoin(fuelVehicles, eq(fuelVehicles.id, fleetTransferItems.vehicleId))
    .innerJoin(worksites, eq(worksites.id, fleetTransferItems.fromWorksiteId))
    .where(inArray(fleetTransferItems.transferId, transferIds))
    .orderBy(asc(fuelVehicles.code), asc(fuelVehicles.plate))
  const openStays = await db.select({ vehicleId: stays.vehicleId, transferId: stays.transferId })
    .from(stays)
    .where(and(inArray(stays.vehicleId, [...new Set(itemRows.map((row) => row.vehicleId))]), sql`${stays.endedOn} IS NULL`))
  const openTransferByVehicle = new Map(openStays.map((stay) => [stay.vehicleId, stay.transferId]))

  const itemsByTransfer = new Map<string, typeof itemRows>()
  for (const row of itemRows) itemsByTransfer.set(row.transferId, [...(itemsByTransfer.get(row.transferId) ?? []), row])

  return transfers.map((transfer) => {
    const rows = itemsByTransfer.get(transfer.id) ?? []
    const visible = inScope(scope, transfer.toWorksiteId) ? rows : rows.filter((row) => inScope(scope, row.fromWorksiteId))
    // Con TODOS los equipos, no sólo los visibles: el servidor exige el traslado completo.
    const voidable = transfer.voidedAt === null
      && rows.every((row) => openTransferByVehicle.get(row.vehicleId) === transfer.id)
      && voidWindowError(transfer.effectiveDate, today) === null
      && inScope(scope, transfer.toWorksiteId)
      && rows.every((row) => inScope(scope, row.fromWorksiteId))
    return {
      ...transfer,
      items: visible.map((row) => ({
        vehicleId: row.vehicleId,
        code: row.code ?? "",
        plate: row.plate,
        fromWorksiteId: row.fromWorksiteId,
        fromWorksiteName: row.fromWorksiteName,
      })),
      voidable,
    }
  })
}
