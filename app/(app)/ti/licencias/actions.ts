"use server"

import { revalidatePath } from "next/cache"
import { requirePermission } from "@/lib/auth/can"
import { safeActionMessage } from "@/lib/action-error"
import { parseZ } from "@/lib/actions/parse-z"
import { logger } from "@/lib/logger"
import {
  createLicense, assignLicense, revokeLicenseAssignment,
} from "@/lib/services/ti/licenses"
import { itLicenseSchema, itLicenseAssignmentSchema } from "@/lib/validation/ti"
import type { ActionState } from "@/lib/validation/masters"

export async function createLicenseAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("ti:manage_licenses") }
  catch { return { ok: false, message: "Sin permisos para gestionar licencias" } }

  const parsed = parseZ(itLicenseSchema, {
    name: formData.get("name"),
    supplierId: formData.get("supplierId"),
    type: formData.get("type"),
    purchasedQuantity: formData.get("purchasedQuantity"),
    cost: formData.get("cost"),
    periodicity: formData.get("periodicity") || undefined,
    startDate: formData.get("startDate"),
    renewalDate: formData.get("renewalDate"),
    responsibleUserId: formData.get("responsibleUserId"),
    notes: formData.get("notes"),
  }, "Revisa los datos de la licencia")
  if (!parsed.ok) return parsed

  try {
    await createLicense(parsed.data, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath("/ti")
    revalidatePath("/ti/licencias")
    return { ok: true, message: "Licencia registrada" }
  } catch (error) {
    logger.error("[ti:createLicense]", error)
    return { ok: false, message: safeActionMessage(error, "Error al registrar la licencia") }
  }
}

export async function assignLicenseAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("ti:manage_licenses") }
  catch { return { ok: false, message: "Sin permisos para asignar licencias" } }

  const parsed = parseZ(itLicenseAssignmentSchema, {
    licenseId: formData.get("licenseId"),
    workerId: formData.get("workerId"),
    assetId: formData.get("assetId"),
    area: formData.get("area"),
    worksiteId: formData.get("worksiteId"),
    notes: formData.get("notes"),
  }, "Revisa la asignación")
  if (!parsed.ok) return parsed

  try {
    await assignLicense(parsed.data, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath("/ti")
    revalidatePath("/ti/licencias")
    return { ok: true, message: "Licencia asignada" }
  } catch (error) {
    logger.error("[ti:assignLicense]", error)
    return { ok: false, message: safeActionMessage(error, "Error al asignar la licencia") }
  }
}

export async function revokeLicenseAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let session
  try { session = await requirePermission("ti:manage_licenses") }
  catch { return { ok: false, message: "Sin permisos" } }

  const assignmentId = String(formData.get("assignmentId") ?? "")
  if (!assignmentId) return { ok: false, message: "Asignación no especificada" }

  try {
    await revokeLicenseAssignment(assignmentId, {
      userId: session.user.id,
      userEmail: session.user.email ?? undefined,
    })
    revalidatePath("/ti")
    revalidatePath("/ti/licencias")
    return { ok: true, message: "Asignación revocada" }
  } catch (error) {
    logger.error("[ti:revokeLicense]", error)
    return { ok: false, message: safeActionMessage(error, "Error al revocar la asignación") }
  }
}
