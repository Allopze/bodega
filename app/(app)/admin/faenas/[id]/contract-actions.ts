"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { contracts } from "@/db/schema"
import { safeActionMessage } from "@/lib/action-error"
import { guardPermission } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { revalidateVehicleFicha } from "@/lib/routing/revalidate-vehicle-ficha"
import { assignVehiclesToContract } from "@/lib/services/contracts/assignments"
import { createMandante, saveOperationalContract } from "@/lib/services/contracts/contracts"
import { contractAssignmentSchema } from "@/lib/validation/contracts"
import type { ActionState } from "@/lib/validation/masters"

/**
 * Acciones del detalle de faena: contratos, mandantes y asignación de equipos.
 * Los servicios no revisan permisos, así que cada acción pide el suyo y valida
 * el alcance de faena del contrato antes de escribir (la faena es el único eje
 * de alcance; un contrato no concede acceso a nada).
 */

/** El detalle de la faena, la lista (que cuenta contratos) y el costo por contrato del Panel. */
function revalidateWorksiteContracts(worksiteId: string): void {
  revalidatePath(`/admin/faenas/${worksiteId}`)
  revalidatePath("/admin/faenas")
  revalidatePath("/control-operacional")
}

const NO_ACCESS = "No tienes acceso a esta faena"

/** Crea o edita un contrato de la faena (`admin:worksites` + alcance sobre la faena). */
export async function saveOperationalContractAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardPermission("admin:worksites")
  if (error) return error

  const worksiteId = typeof (input as { worksiteId?: unknown } | null)?.worksiteId === "string"
    ? (input as { worksiteId: string }).worksiteId
    : ""
  if (!worksiteId) return { ok: false, message: "Elige la faena", fieldErrors: { worksiteId: ["Elige la faena"] } }
  if (!canAccessWorksite(session, worksiteId)) return { ok: false, message: NO_ACCESS }

  try {
    // Al editar, el alcance se valida también sobre la faena GUARDADA del
    // contrato: la del formulario la controla quien envía. El servicio además
    // rechaza cambiar la faena, pero el permiso no debe depender de eso.
    const contractId = typeof (input as { id?: unknown } | null)?.id === "string" ? (input as { id: string }).id : ""
    if (contractId) {
      const [stored] = await db.select({ worksiteId: contracts.worksiteId }).from(contracts)
        .where(eq(contracts.id, contractId)).limit(1)
      if (!stored) return { ok: false, message: "El contrato ya no existe: recarga la página." }
      if (!stored.worksiteId || !canAccessWorksite(session, stored.worksiteId)) return { ok: false, message: NO_ACCESS }
    }

    const result = await saveOperationalContract({ userId: session.user.id, email: session.user.email }, input)
    if (!result.ok) return { ok: false, message: result.message, fieldErrors: result.fieldErrors }
    revalidateWorksiteContracts(worksiteId)
    return { ok: true, message: `Contrato ${result.code} guardado`, data: { id: result.id, code: result.code } }
  } catch (e) {
    return { ok: false, message: safeActionMessage(e, "No se pudo guardar el contrato") }
  }
}

/** Crea el mandante por RUT o reutiliza el que ya existe (`admin:worksites`). */
export async function createMandanteAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardPermission("admin:worksites")
  if (error) return error

  try {
    const result = await createMandante({ userId: session.user.id, email: session.user.email }, input)
    if (!result.ok) return { ok: false, message: result.message }
    return {
      ok: true,
      message: result.existed ? "Ese RUT ya era un mandante: se usará el existente" : "Mandante creado",
      data: { id: result.id, existed: result.existed },
    }
  } catch (e) {
    return { ok: false, message: safeActionMessage(e, "No se pudo crear el mandante") }
  }
}

/** Asigna equipos a un contrato desde un día (`mant:equipment:manage` + alcance sobre la faena del contrato). */
export async function assignVehiclesAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardPermission("mant:equipment:manage")
  if (error) return error

  const parsed = contractAssignmentSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Datos inválidos" }

  try {
    const [contract] = await db.select({ worksiteId: contracts.worksiteId }).from(contracts)
      .where(eq(contracts.id, parsed.data.contractId)).limit(1)
    if (!contract) return { ok: false, message: "El contrato ya no existe: recarga la página." }
    if (!contract.worksiteId) return { ok: false, message: "El contrato no tiene faena: no se le pueden asignar equipos" }
    if (!canAccessWorksite(session, contract.worksiteId)) return { ok: false, message: NO_ACCESS }

    const result = await assignVehiclesToContract({ userId: session.user.id, email: session.user.email }, parsed.data)
    if (!result.ok) return { ok: false, message: result.message }

    revalidateWorksiteContracts(contract.worksiteId)
    for (const vehicleId of new Set(parsed.data.vehicleIds)) revalidateVehicleFicha(vehicleId)
    return {
      ok: true,
      message: result.assigned === 1 ? "1 equipo asignado" : `${result.assigned} equipos asignados`,
      data: { warnings: result.warnings },
    }
  } catch (e) {
    return { ok: false, message: safeActionMessage(e, "No se pudieron asignar los equipos") }
  }
}
