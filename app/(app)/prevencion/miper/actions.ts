"use server"

import { revalidatePath } from "next/cache"
import { ZodError } from "zod"
import { unexpectedActionError } from "@/lib/actions/safe-server-action"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import type { Permission } from "@/modules/permissions"
import {
  addRiskEntry,
  createRiskMatrixDraft,
  createRiskMethodology,
  createRiskReviewTrigger,
  ensureIspRiskMethodology,
  resolveRiskReviewTrigger,
  transitionRiskMatrix,
  verifyRiskControl,
  type RiskLegalAccess,
} from "@/lib/services/prevention-risk-legal"
import {
  activateRiskImportBatch,
  approveRiskImportBatch,
  reopenRiskImportBatch,
  resolveRiskImportRow,
  stageRiskImport,
  RISK_IMPORT_MAX_BYTES,
} from "@/lib/services/prevention-risk-import"
import {
  addRiskMapMarker,
  removeRiskMapMarker,
} from "@/lib/services/prevention-risk-map"
import type { ActionState } from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/miper"

function accessFromSession(session: Awaited<ReturnType<typeof guardPermission>>["session"]): RiskLegalAccess {
  if (!session) throw new Error("Sesión no disponible.")
  return { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
}

async function run(access: RiskLegalAccess, operation: (access: RiskLegalAccess) => Promise<unknown>): Promise<ActionState> {
  try {
    await operation(access)
    revalidatePath(REVALIDATE)
    revalidatePath("/prevencion/pdtp/cobertura")
    return { ok: true }
  } catch (error) {
    if (error instanceof ZodError) return { ok: false, message: "Revisa los campos marcados.", fieldErrors: error.flatten().fieldErrors as Record<string, string[]> }
    return unexpectedActionError(error, "prevencion/miper/actions")
  }
}

export async function ensureIspRiskMethodologyAction(): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), ensureIspRiskMethodology)
}

export async function createRiskMethodologyAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createRiskMethodology(input, access))
}

export async function createRiskMatrixDraftAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createRiskMatrixDraft(input, access))
}

export async function addRiskEntryAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => addRiskEntry(input, access))
}

export async function transitionRiskMatrixAction(input: unknown): Promise<ActionState> {
  const toStatus = typeof input === "object" && input && "toStatus" in input ? String(input.toStatus) : ""
  // 'draft' es la devolución del revisor (MIPER-10): mismo permiso que revisar,
  // no el de editar — devolver es una decisión de revisión, no una corrección.
  const permission: Permission = toStatus === "reviewed" || toStatus === "draft" ? "prevention:risk:review" : toStatus === "approved" ? "prevention:risk:approve" : toStatus === "published" ? "prevention:risk:publish" : "prevention:risk:edit"
  const guard = await guardPermission(permission)
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => transitionRiskMatrix(input, access))
}

export async function createRiskReviewTriggerAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => createRiskReviewTrigger(input, access))
}

export async function resolveRiskReviewTriggerAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:review")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => resolveRiskReviewTrigger(input, access))
}

export async function stageRiskImportAction(formData: FormData): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return guard.error
  try {
    const file = formData.get("file")
    const worksiteId = String(formData.get("worksiteId") ?? "")
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Selecciona un archivo Excel." }
    // Corta antes de bufferizar: `unexpectedActionError` oculta el detalle del
    // servicio, así que el límite se explica aquí como en la ruta PDTP.
    if (file.size > RISK_IMPORT_MAX_BYTES) {
      return { ok: false, message: `El archivo supera el límite de ${Math.round(RISK_IMPORT_MAX_BYTES / 1024 / 1024)} MB.` }
    }
    if (!/\.xlsx$/i.test(file.name)) return { ok: false, message: "El archivo debe ser .xlsx; .xls no está permitido." }
    await stageRiskImport({ worksiteId, fileName: file.name, buffer: Buffer.from(await file.arrayBuffer()), mimeType: file.type, access: accessFromSession(guard.session) })
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (error) {
    return unexpectedActionError(error, "prevencion/miper/actions")
  }
}

export async function resolveRiskImportRowAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => resolveRiskImportRow(input, access))
}

export async function approveRiskImportBatchAction(batchId: string): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:approve")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => approveRiskImportBatch(batchId, access))
}

export async function activateRiskImportBatchAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => activateRiskImportBatch(input, access))
}

export async function reopenRiskImportBatchAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => reopenRiskImportBatch(input, access))
}

export async function verifyRiskControlAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return guard.error
  const state = await run(accessFromSession(guard.session), (access) => verifyRiskControl(input, access))
  // La ficha del control es una ruta dinámica: `run` sólo revalida el listado.
  revalidatePath(`${REVALIDATE}/controles/[id]`, "page")
  return state
}

/* ── Mapa de riesgos ───────────────────────────────────────────────────────── */

export async function addRiskMapMarkerAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => addRiskMapMarker(input, access))
}

export async function removeRiskMapMarkerAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("prevention:risk:edit")
  if (guard.error) return guard.error
  return run(accessFromSession(guard.session), (access) => removeRiskMapMarker(input, access))
}
