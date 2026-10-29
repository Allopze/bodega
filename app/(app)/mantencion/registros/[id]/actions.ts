"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { guardPermission } from "@/lib/auth/can"
import { viewerFromSession } from "@/lib/services/mantencion/access"
import { exportRecords, type ExportOutcome } from "@/lib/services/mantencion/export-records"
import { markRecordReviewed, observeRecord, voidRecord } from "@/lib/services/mantencion/record-lifecycle"
import type { MantActionResult } from "@/lib/services/mantencion/result"
import { parseRecordFilters } from "@/lib/services/mantencion/records-filters"
import { reasonSchema } from "@/lib/validation/reason-thresholds"

/**
 * Acciones de jefatura sobre un registro firmado: observar, marcar revisado,
 * anular y exportar a Excel. Cada una pide su permiso del §6 EN el servidor y el
 * servicio (`record-lifecycle`) vuelve a verificar el alcance sobre ESE registro
 * (un supervisor sólo observa en su faena); ocultar un botón no es control de
 * acceso. Los mensajes están en español y se muestran tal cual.
 */

const recordId = z.string().trim().min(1).max(64)
const observationSchema = z.object({
  recordId,
  text: z.string().trim().min(3, "Escribe qué hay que revisar (al menos 3 caracteres).").max(1000, "La observación no puede superar 1.000 caracteres."),
})
const voidSchema = z.object({ recordId, reason: reasonSchema("por qué se anula el registro") })

/** Después de un cambio, se refrescan el detalle, la lista y el panel (los KPI excluyen anulados). */
function revalidateRecord(id: string) {
  revalidatePath(`/mantencion/registros/${id}`)
  revalidatePath("/mantencion/registros")
  revalidatePath("/mantencion/panel")
}

export async function observeRecordAction(input: { recordId: string; text: string }): Promise<MantActionResult> {
  const guard = await guardPermission("mant:records:observe", "/mantencion/registros")
  if (guard.error) return guard.error
  const parsed = observationSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa la observación." }
  const result = await observeRecord({ recordId: parsed.data.recordId, text: parsed.data.text, viewer: viewerFromSession(guard.session) })
  if (result.ok) revalidateRecord(parsed.data.recordId)
  return result
}

export async function markRecordReviewedAction(input: { recordId: string }): Promise<MantActionResult> {
  const guard = await guardPermission("mant:records:review", "/mantencion/registros")
  if (guard.error) return guard.error
  const parsed = z.object({ recordId }).safeParse(input)
  if (!parsed.success) return { ok: false, message: "No se reconoce el registro." }
  const result = await markRecordReviewed({ recordId: parsed.data.recordId, viewer: viewerFromSession(guard.session) })
  if (result.ok) revalidateRecord(parsed.data.recordId)
  return result
}

export async function voidRecordAction(input: { recordId: string; reason: string }): Promise<MantActionResult> {
  const guard = await guardPermission("mant:records:void", "/mantencion/registros")
  if (guard.error) return guard.error
  const parsed = voidSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Revisa el motivo.", field: "reason" }
  const result = await voidRecord({ recordId: parsed.data.recordId, reason: parsed.data.reason, viewer: viewerFromSession(guard.session) })
  if (result.ok) revalidateRecord(parsed.data.recordId)
  return result
}

/** Excel de ESTE registro (el mismo libro de cinco hojas, con una fila en la primera). */
export async function exportRecordAction(input: { recordId: string }): Promise<ExportOutcome> {
  const guard = await guardPermission("mant:export", "/mantencion/registros")
  if (guard.error) return guard.error
  const parsed = z.object({ recordId }).safeParse(input)
  if (!parsed.success) return { ok: false, message: "No se reconoce el registro." }
  return exportRecords({ session: guard.session, filters: parseRecordFilters({}), recordId: parsed.data.recordId })
}
