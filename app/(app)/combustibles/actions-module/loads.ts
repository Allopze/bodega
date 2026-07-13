"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { fuelLoads, fuelVehicles } from "@/db/schema"
import { eq } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { nanoid } from "@/lib/id"
import {
  createFuelLoadSchema,
  updateFuelLoadSchema,
} from "@/lib/combustibles/validation"
import { calculateFuelAmounts } from "@/lib/combustibles/calculations"
import { recordAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import type { ActionState } from "@/lib/validation/masters"
import { optionalNumber } from "./export"
import { fuelProductIdForLegacy } from "@/lib/combustibles/fuel-products"

const REVALIDATE = "/combustibles"

export async function dbErrMsg(e: unknown, fallback: string): Promise<string> {
  if (!(e instanceof Error)) return fallback
  const cause = (e as { cause?: unknown }).cause
  if (cause instanceof Error && cause.message) return cause.message
  return e.message
}

export async function createFuelLoadAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:create") }
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
    const [fixedRateRow, variableRateRow] = await Promise.all([
      db.query.systemSettings.findFirst({ where: (t, { eq }) => eq(t.key, "fuel:iec_fixed_rate") }),
      db.query.systemSettings.findFirst({ where: (t, { eq }) => eq(t.key, "fuel:iec_variable_rate") }),
    ])

    const calc = calculateFuelAmounts({
      liters,
      baseAmount,
      iecFixedRate: fixedRateRow ? Number(fixedRateRow.value) : null,
      iecVariableRate: variableRateRow ? Number(variableRateRow.value) : null,
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
    await db.insert(fuelLoads).values({
      id,
      ...parsed.data,
      productId: fuelProductIdForLegacy(parsed.data.product),
      createdBy: session.user.id,
    })

    await recordAudit({
      userId: session.user.id,
      action: "create",
      entityType: "fuel_load",
      entityId: id,
      newState: { ...parsed.data, worksiteId: parsed.data.worksiteId },
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
  try { session = await requirePermission("combustibles:create") }
  catch { return { ok: false, message: "Sin permisos" } }

  const id = String(formData.get("id") ?? "")
  if (!id) return { ok: false, message: "ID requerido" }

  const existing = await db.query.fuelLoads.findFirst({ where: eq(fuelLoads.id, id) })
  if (!existing) return { ok: false, message: "Carga no encontrada" }
  if (existing.status === "reconciled") return { ok: false, message: "No se puede editar una carga conciliada" }

  if (existing.statementId) {
    return { ok: false, message: "No se puede editar una carga asignada a una cuenta corriente" }
  }
  if (!canAccessWorksite(session, existing.worksiteId)) {
    return { ok: false, message: "Sin acceso a la faena de esta carga" }
  }

  // Validación cruzada: si cambió el vehículo, verificar que su faena coincida
  const newVehicleId = String(formData.get("vehicleId") ?? existing.vehicleId)
  const newWorksiteId = String(formData.get("worksiteId") ?? existing.worksiteId)
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
    iecFixed: Number(formData.get("iecFixed") ?? existing.iecFixed),
    iecVariable: Number(formData.get("iecVariable") ?? existing.iecVariable),
    iecTotal: Number(formData.get("iecTotal") ?? existing.iecTotal),
    ivaAmount: Number(formData.get("ivaAmount") ?? existing.ivaAmount),
    totalAmount: Number(formData.get("totalAmount") ?? existing.totalAmount),
    notes: formData.get("notes") ?? existing.notes,
  })

  if (!parsed.success) {
    return { ok: false, message: "Revisa los datos", fieldErrors: parsed.error.flatten().fieldErrors }
  }

  const expectedTotal = parsed.data.baseAmount! + parsed.data.iecTotal! + parsed.data.ivaAmount!
  if (Math.abs(parsed.data.totalAmount! - expectedTotal) > 1) {
    return { ok: false, message: `Total (${parsed.data.totalAmount}) no cuadra con base + IEC + IVA (${expectedTotal})` }
  }

  try {
    await db.update(fuelLoads).set({ ...parsed.data, productId: fuelProductIdForLegacy(parsed.data.product), updatedAt: new Date().toISOString() }).where(eq(fuelLoads.id, id))

    await recordAudit({
      userId: session.user.id,
      action: "update",
      entityType: "fuel_load",
      entityId: id,
      oldState: { liters: existing.liters, baseAmount: existing.baseAmount, totalAmount: existing.totalAmount },
      newState: { liters: parsed.data.liters, baseAmount: parsed.data.baseAmount, totalAmount: parsed.data.totalAmount },
    })

    revalidatePath(REVALIDATE)
    return { ok: true, message: "Carga actualizada" }
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, "Error al actualizar") }
  }
}

export async function deleteFuelLoadAction(id: string): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:delete") }
  catch { return { ok: false, message: "Sin permisos para eliminar" } }

  const existing = await db.query.fuelLoads.findFirst({ where: eq(fuelLoads.id, id) })
  if (!existing) return { ok: false, message: "Carga no encontrada" }
  if (existing.statementId) {
    return { ok: false, message: "No se puede eliminar una carga asignada a una cuenta corriente" }
  }
  if (!canAccessWorksite(session, existing.worksiteId)) {
    return { ok: false, message: "Sin acceso a la faena de esta carga" }
  }
  if (existing.status === "reconciled") {
    return { ok: false, message: "No se puede eliminar una carga conciliada" }
  }

  try {
    await db.delete(fuelLoads).where(eq(fuelLoads.id, id))

    await recordAudit({
      userId: session.user.id,
      action: "delete",
      entityType: "fuel_load",
      entityId: id,
      oldState: { worksiteId: existing.worksiteId, totalAmount: existing.totalAmount },
    })

    revalidatePath(REVALIDATE)
    return { ok: true, message: "Carga eliminada" }
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, "Error al eliminar") }
  }
}

export async function registerFuelLoadAction(id: string): Promise<ActionState> {
  let session
  try { session = await requirePermission("combustibles:create") }
  catch { return { ok: false, message: "Sin permisos" } }

  const existing = await db.query.fuelLoads.findFirst({ where: eq(fuelLoads.id, id) })
  if (!existing) return { ok: false, message: "Carga no encontrada" }
  if (existing.status !== "draft") return { ok: false, message: "Solo se pueden registrar cargas en borrador" }
  if (!canAccessWorksite(session, existing.worksiteId)) {
    return { ok: false, message: "Sin acceso a la faena de esta carga" }
  }

  try {
    await db.update(fuelLoads).set({ status: "registered", updatedAt: new Date().toISOString() }).where(eq(fuelLoads.id, id))
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Carga registrada" }
  } catch (e) {
    return { ok: false, message: await dbErrMsg(e, "Error al registrar") }
  }
}
