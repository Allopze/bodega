"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { dteDocuments, fuelLoads, fuelVehicles } from "@/db/schema"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import {
  createFuelLoadSchema,
  updateFuelLoadSchema,
} from "@/lib/combustibles/validation"
import { calculateFuelAmounts } from "@/lib/combustibles/calculations"
import { getFuelIecRates } from "@/lib/services/system-settings"
import { recordAudit } from "@/lib/audit"
import {
  DELETABLE_FUEL_LOAD_STATUSES,
  EDITABLE_FUEL_LOAD_STATUSES,
  fuelLoadStatusBlockMessage,
} from "@/lib/combustibles/load-status"
import { logger } from "@/lib/logger"
import { isNetworkError } from "@/lib/network-error"
import { safeActionMessage } from "@/lib/action-error"
import type { ActionState } from "@/lib/validation/masters"
import { optionalNumber } from "./export"
import { fuelProductIdForLegacy } from "@/lib/combustibles/fuel-products"
import { reevaluateFuelLoadAnomalies } from "@/lib/combustibles/fuel-load-anomaly-reevaluation"
import { notifyAfterCommit } from "@/lib/services/notifications"

const REVALIDATE = "/combustibles"

const CONN_MSG = "Sin conexión al servidor. Verifica tu conexión a internet e inténtalo nuevamente."

/** Campos editables de una carga que deben quedar en el diff de auditoría. */
const AUDITED_LOAD_FIELDS = [
  "loadDate", "month", "serviceType", "vehicleId", "fuelSupplierId", "worksiteId",
  "product", "receiptNumber", "odometerReading", "hourMeterReading", "liters",
  "iecFixed", "iecVariable", "baseAmount", "iecTotal", "ivaAmount", "totalAmount", "notes",
] as const

function pickAuditedLoadFields(source: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {}
  for (const key of AUDITED_LOAD_FIELDS) {
    if (source[key] !== undefined) picked[key] = source[key]
  }
  return picked
}

/**
 * DTE del portal vinculado a esta carga, si lo hay. El vínculo lo escribe la
 * conciliación (`matchToFuelLoads`) sobre `dte_documents` y NO deja rastro en
 * `fuel_loads`: sin consultarlo, ni el borrado ni la edición saben que están
 * tocando la contraparte de un documento tributario.
 */
async function linkedDteDocument(loadId: string) {
  return db.query.dteDocuments.findFirst({
    where: eq(dteDocuments.fuelLoadId, loadId),
    columns: { id: true, tipoDte: true, folio: true },
  })
}

function dteReference(doc: { tipoDte: string; folio: number }): string {
  return `el DTE tipo ${doc.tipoDte} folio ${doc.folio}`
}

export async function dbErrMsg(e: unknown, fallback: string): Promise<string> {
  if (!(e instanceof Error)) return fallback
  if (isNetworkError(e)) return CONN_MSG
  // Devolvía `cause.message`, o sea el texto del motor: una violación de FK
  // publicaba el nombre de la constraint en el toast. `safeActionMessage`
  // conserva los errores de negocio y esconde los del driver.
  return safeActionMessage(e, fallback)
}

export async function createFuelLoadAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:create", "/combustibles") }
  catch { return { ok: false, message: "Sin permisos para crear cargas" } }

  const liters = Number(formData.get("liters") ?? 0)
  const baseAmount = Number(formData.get("baseAmount") ?? 0)
  const autoCalc = formData.get("autoCalc") === "true"

  let iecFixed = Number(formData.get("iecFixed") ?? 0)
  let iecVariable = Number(formData.get("iecVariable") ?? 0)
  let iecTotal = Number(formData.get("iecTotal") ?? 0)
  let ivaAmount = Number(formData.get("ivaAmount") ?? 0)
  let totalAmount = Number(formData.get("totalAmount") ?? 0)

  if (autoCalc) {
    const rates = await getFuelIecRates()

    const calc = calculateFuelAmounts({
      liters,
      baseAmount,
      iecFixedRate: rates.iecFixedRate,
      iecVariableRate: rates.iecVariableRate,
    })

    iecFixed = calc.iecFixed
    iecVariable = calc.iecVariable
    iecTotal = calc.iecTotal
    ivaAmount = calc.ivaAmount
    totalAmount = calc.totalAmount
  }

  const loadDate = String(formData.get("loadDate") ?? "")
  const month = loadDate.substring(0, 7)

  const parsed = createFuelLoadSchema.safeParse({
    loadDate,
    month,
    serviceType: formData.get("serviceType"),
    vehicleId: formData.get("vehicleId"),
    fuelSupplierId: formData.get("fuelSupplierId"),
    worksiteId: formData.get("worksiteId"),
    product: formData.get("product"),
    receiptNumber: formData.get("receiptNumber") || undefined,
    odometerReading: await optionalNumber(formData.get("odometerReading")),
    hourMeterReading: await optionalNumber(formData.get("hourMeterReading")),
    liters,
    iecFixed,
    iecVariable,
    baseAmount,
    iecTotal,
    ivaAmount,
    totalAmount,
    notes: formData.get("notes") || undefined,
  })

  if (!parsed.success) {
    return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  }

  const expectedTotal = parsed.data.baseAmount + parsed.data.iecTotal + parsed.data.ivaAmount
  if (Math.abs(parsed.data.totalAmount - expectedTotal) > 1) {
    return { ok: false, message: `Total (${parsed.data.totalAmount}) no cuadra con base + IEC + IVA (${expectedTotal})` }
  }

  if (!canAccessWorksite(session, parsed.data.worksiteId)) {
    return { ok: false, message: "No puedes registrar cargas para esta faena" }
  }

  // Validación cruzada: la faena de la carga debe coincidir con la faena del vehículo
  const vehicle = await db.query.fuelVehicles.findFirst({
    where: eq(fuelVehicles.id, parsed.data.vehicleId),
    with: { worksite: true },
  })
  if (vehicle && vehicle.worksite && vehicle.worksiteId !== parsed.data.worksiteId) {
    return {
      ok: false,
      message: `La faena de la carga no coincide con la faena del vehículo. El vehículo ${vehicle.plate} pertenece a "${vehicle.worksite.name}", pero seleccionaste otra faena. Verifica los datos.`,
    }
  }

  try {
    const id = nanoid()
    // Auditoría dentro de la misma transacción que el insert: si `recordAudit`
    // fallaba, la carga ya había quedado creada sin rastro (CO-025).
    await db.transaction(async (tx) => {
      await tx.insert(fuelLoads).values({
        id,
        ...parsed.data,
        productId: fuelProductIdForLegacy(parsed.data.product),
        createdBy: session.user.id,
      })

      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: "create",
        entityType: "fuel_load",
        entityId: id,
        newState: { ...parsed.data, worksiteId: parsed.data.worksiteId },
      }, tx)
    })
  } catch (e) {
    logger.error("createFuelLoad error", { error: e })
    return { ok: false, message: await dbErrMsg(e, "Error al registrar carga") }
  }

  // redirect() fuera del try/catch: lanza una excepción de control de flujo
  // interna de Next que un catch genérico interceptaría y trataría como
  // error. Se navega server-side en vez de que el cliente haga router.push
  // tras leer el estado: la acción vive en /combustibles/nueva y revalida
  // /combustibles (otra ruta) — en Next.js 16 cualquier revalidatePath en una
  // action re-renderiza la ruta ACTUAL en la misma respuesta, lo que remonta
  // el formulario cliente antes de que el useEffect llegue a disparar el
  // push. redirect() evita la carrera por completo.
  revalidatePath(REVALIDATE)
  redirect(REVALIDATE)
}

export async function updateFuelLoadAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:create", "/combustibles") }
  catch { return { ok: false, message: "Sin permisos" } }

  const id = String(formData.get("id") ?? "")
  if (!id) return { ok: false, message: "ID requerido" }

  const existing = await db.query.fuelLoads.findFirst({ where: eq(fuelLoads.id, id) })
  if (!existing) return { ok: false, message: "Carga no encontrada" }
  // Antes sólo `reconciled` bloqueaba: una carga anulada se podía editar y
  // volvía al circuito sin transición alguna.
  if (!(EDITABLE_FUEL_LOAD_STATUSES as readonly string[]).includes(existing.status)) {
    return { ok: false, message: fuelLoadStatusBlockMessage(existing.status, "editar") }
  }

  if (existing.statementId) {
    return { ok: false, message: "No se puede editar una carga asignada a una cuenta corriente" }
  }
  if (!canAccessWorksite(session, existing.worksiteId)) {
    return { ok: false, message: "Sin acceso a la faena de esta carga" }
  }

  // Validación cruzada: si cambió el vehículo, verificar que su faena coincida
  const newVehicleId = String(formData.get("vehicleId") ?? existing.vehicleId)
  const newWorksiteId = String(formData.get("worksiteId") ?? existing.worksiteId)
  // Hay dos faenas en juego: la actual y la propuesta. Ambas necesitan alcance,
  // igual que updateFuelVehicleAction (vehicles.ts:161) y updateMaintenanceRecord.
  if (!canAccessWorksite(session, newWorksiteId)) {
    return { ok: false, message: "No puedes mover cargas a esta faena" }
  }
  if (newVehicleId !== existing.vehicleId || newWorksiteId !== existing.worksiteId) {
    const vehicle = await db.query.fuelVehicles.findFirst({
      where: eq(fuelVehicles.id, newVehicleId),
      with: { worksite: true },
    })
    if (vehicle && vehicle.worksite && vehicle.worksiteId !== newWorksiteId) {
      return {
        ok: false,
        message: `La faena de la carga no coincide con la faena del vehículo. El vehículo ${vehicle.plate} pertenece a "${vehicle.worksite.name}". Verifica los datos.`,
      }
    }
  }

  const loadDate = String(formData.get("loadDate") ?? existing.loadDate)
  const month = loadDate.substring(0, 7)

  const liters = Number(formData.get("liters") ?? existing.liters)
  const baseAmount = Number(formData.get("baseAmount") ?? existing.baseAmount)

  // El IEC es CLP por LITRO: al cambiar los litros hay que recalcularlo. El
  // formulario de edición no conoce las tasas y reenvía el IEC congelado de la
  // carga, así que sin esto el total quedaba subestimado (y la cuenta corriente
  // con él). Sólo se recalcula si el usuario NO tocó el IEC a mano: si lo
  // cambió, manda su valor.
  let iecFixed = Number(formData.get("iecFixed") ?? existing.iecFixed)
  let iecVariable = Number(formData.get("iecVariable") ?? existing.iecVariable)
  let iecTotal = Number(formData.get("iecTotal") ?? existing.iecTotal)
  let ivaAmount = Number(formData.get("ivaAmount") ?? existing.ivaAmount)
  let totalAmount = Number(formData.get("totalAmount") ?? existing.totalAmount)

  const iecUntouched = iecFixed === Number(existing.iecFixed) && iecVariable === Number(existing.iecVariable)
  if (liters !== Number(existing.liters) && iecUntouched) {
    const rates = await getFuelIecRates()
    const calc = calculateFuelAmounts({
      liters,
      baseAmount,
      iecFixedRate: rates.iecFixedRate,
      iecVariableRate: rates.iecVariableRate,
    })
    iecFixed = calc.iecFixed
    iecVariable = calc.iecVariable
    iecTotal = calc.iecTotal
    ivaAmount = calc.ivaAmount
    totalAmount = calc.totalAmount
  }

  const parsed = updateFuelLoadSchema.safeParse({
    id,
    loadDate,
    month,
    serviceType: formData.get("serviceType") ?? existing.serviceType,
    vehicleId: formData.get("vehicleId") ?? existing.vehicleId,
    fuelSupplierId: formData.get("fuelSupplierId") ?? existing.fuelSupplierId,
    worksiteId: formData.get("worksiteId") ?? existing.worksiteId,
    product: formData.get("product") ?? existing.product,
    receiptNumber: formData.get("receiptNumber") ?? existing.receiptNumber,
    odometerReading: await optionalNumber(formData.get("odometerReading")),
    hourMeterReading: await optionalNumber(formData.get("hourMeterReading")),
    liters,
    baseAmount,
    iecFixed,
    iecVariable,
    iecTotal,
    ivaAmount,
    totalAmount,
    notes: formData.get("notes") ?? existing.notes,
  })

  if (!parsed.success) {
    return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  }

  const expectedTotal = parsed.data.baseAmount! + parsed.data.iecTotal! + parsed.data.ivaAmount!
  if (Math.abs(parsed.data.totalAmount! - expectedTotal) > 1) {
    return { ok: false, message: `Total (${parsed.data.totalAmount}) no cuadra con base + IEC + IVA (${expectedTotal})` }
  }

  // Los tres campos que definen la identidad del vínculo tributario. Cambiarlos
  // con un DTE encima dejaba el documento apuntando a una carga que ya no lo
  // describe (otro proveedor, otra factura, otro monto), sin ningún aviso.
  const text = (value: unknown) => (value ?? "").toString().trim()
  const identityChanged = (
    text(parsed.data.receiptNumber) !== text(existing.receiptNumber)
    || text(parsed.data.fuelSupplierId) !== text(existing.fuelSupplierId)
    || Number(parsed.data.totalAmount) !== Number(existing.totalAmount)
  )
  if (identityChanged) {
    const dte = await linkedDteDocument(id)
    if (dte) {
      return {
        ok: false,
        message: `Esta carga tiene ${dteReference(dte)} vinculado: no se puede cambiar factura, proveedor ni monto sin desvincularlo antes.`,
      }
    }
  }

  try {
    // El gate de :172 lee una fila que puede quedar obsoleta: createMonthlyStatementAction
    // toma FOR UPDATE sobre las cargas sin resumen y las asigna. Repetir la precondición
    // en el WHERE hace que, al despertar del lock, la fila ya no calce y no se pise el
    // total congelado del resumen.
    // Auditoría dentro de la misma transacción que el update (CO-025): antes se
    // llamaba después de que la conexión ya había hecho commit del UPDATE.
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(fuelLoads)
        .set({ ...parsed.data, productId: fuelProductIdForLegacy(parsed.data.product), updatedAt: new Date().toISOString() })
        .where(and(
          eq(fuelLoads.id, id),
          isNull(fuelLoads.statementId),
          // …y el estado esperado: entre la lectura y este UPDATE otra sesión
          // pudo conciliar o anular la carga.
          inArray(fuelLoads.status, [...EDITABLE_FUEL_LOAD_STATUSES]),
        ))
        .returning({ id: fuelLoads.id })
      if (!row) return null

      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: "update",
        entityType: "fuel_load",
        entityId: id,
        // El diff cubría 4 campos: cambiar vehículo, proveedor, factura, producto
        // o fecha no dejaba rastro en el historial. Se guarda el estado editable
        // completo a ambos lados.
        oldState: pickAuditedLoadFields(existing),
        newState: pickAuditedLoadFields(parsed.data),
      }, tx)
      return row
    })
    if (!updated) {
      return { ok: false, message: "La carga cambió en otra sesión: se concilió, se anuló o quedó asignada a una cuenta corriente. Recarga antes de continuar." }
    }

    revalidatePath(REVALIDATE)
    revalidatePath("/combustibles/anomalias")
    notifyAfterCommit(() => reevaluateFuelLoadAnomalies(id, session.user.id))
    return { ok: true, message: "Carga actualizada" }
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, "Error al actualizar") }
  }
}

export async function deleteFuelLoadAction(id: string): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:delete", "/combustibles") }
  catch { return { ok: false, message: "Sin permisos para eliminar" } }

  const existing = await db.query.fuelLoads.findFirst({ where: eq(fuelLoads.id, id) })
  if (!existing) return { ok: false, message: "Carga no encontrada" }
  if (existing.statementId) {
    return { ok: false, message: "No se puede eliminar una carga asignada a una cuenta corriente" }
  }
  if (!canAccessWorksite(session, existing.worksiteId)) {
    return { ok: false, message: "Sin acceso a la faena de esta carga" }
  }
  if (!(DELETABLE_FUEL_LOAD_STATUSES as readonly string[]).includes(existing.status)) {
    return { ok: false, message: fuelLoadStatusBlockMessage(existing.status, "eliminar") }
  }
  // La FK de dte_documents es ON DELETE NO ACTION: sin esta guarda el DELETE
  // llegaba a Postgres y el usuario recibía el 23503 con el nombre de la
  // constraint dentro del toast.
  const dte = await linkedDteDocument(id)
  if (dte) {
    return {
      ok: false,
      message: `No se puede eliminar: esta carga es la contraparte de ${dteReference(dte)}. Desvincula el documento antes de borrarla.`,
    }
  }

  try {
    // Misma carrera que en la edición: sin FK que frene el DELETE, una carga
    // recién asignada a un resumen desaparecería del detalle sin salir del total.
    // Auditoría dentro de la misma transacción que el delete (CO-025).
    const deleted = await db.transaction(async (tx) => {
      const [row] = await tx.delete(fuelLoads)
        .where(and(
          eq(fuelLoads.id, id),
          isNull(fuelLoads.statementId),
          inArray(fuelLoads.status, [...DELETABLE_FUEL_LOAD_STATUSES]),
        ))
        .returning({ id: fuelLoads.id })
      if (!row) return null

      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: "delete",
        entityType: "fuel_load",
        entityId: id,
        oldState: { worksiteId: existing.worksiteId, totalAmount: existing.totalAmount },
      }, tx)
      return row
    })
    if (!deleted) {
      return { ok: false, message: "La carga cambió en otra sesión: se concilió o quedó asignada a una cuenta corriente. Recarga antes de continuar." }
    }

    revalidatePath(REVALIDATE)
    return { ok: true, message: "Carga eliminada" }
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, "Error al eliminar") }
  }
}

export async function registerFuelLoadAction(id: string): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:create", "/combustibles") }
  catch { return { ok: false, message: "Sin permisos" } }

  const existing = await db.query.fuelLoads.findFirst({ where: eq(fuelLoads.id, id) })
  if (!existing) return { ok: false, message: "Carga no encontrada" }
  if (existing.status !== "draft") return { ok: false, message: "Solo se pueden registrar cargas en borrador" }
  if (!canAccessWorksite(session, existing.worksiteId)) {
    return { ok: false, message: "Sin acceso a la faena de esta carga" }
  }

  try {
    // El estado esperado viaja en el WHERE: dos clics simultáneos, o un registro
    // que corrió mientras se leía, no pueden reescribir el estado dos veces.
    // La transición draft→registered no auditaba en absoluto (CO-025): quedaba
    // sin rastro quién sacó la carga de borrador y cuándo.
    const registered = await db.transaction(async (tx) => {
      const [row] = await tx.update(fuelLoads)
        .set({ status: "registered", updatedAt: new Date().toISOString() })
        .where(and(eq(fuelLoads.id, id), eq(fuelLoads.status, "draft")))
        .returning({ id: fuelLoads.id })
      if (!row) return null

      await recordAudit({
        userId: session.user.id,
        userEmail: session.user.email ?? undefined,
        action: "update",
        entityType: "fuel_load",
        entityId: id,
        oldState: { status: "draft" },
        newState: { status: "registered" },
      }, tx)
      return row
    })
    if (!registered) return { ok: false, message: "La carga ya no está en borrador. Recarga antes de continuar." }
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Carga registrada" }
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, "Error al registrar") }
  }
}
