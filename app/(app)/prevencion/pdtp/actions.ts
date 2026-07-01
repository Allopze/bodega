"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { guardAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  markPdtpExecution,
  approvePdtpProgramJdpr,
  signPdtpProgramLegal,
  activatePdtpProgram,
  approvePdtpExecution,
  updatePdtpActivity,
  addPdtpActivity,
} from "@/lib/services/prevention-pdtp"
import type { ActionState } from "@/lib/validation/prevention"
import {
  pdtpExecutionApprovalSchema,
  pdtpActivityUpdateSchema,
  pdtpActivityAddSchema,
} from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/pdtp"

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

// ── Existing actions (keep unchanged) ──────────────────────────────────────

export async function markPdtpExecutionAction(formData: FormData): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:manage")) {
    return { ok: false, message: "No tienes permisos para registrar ejecución PDTP." }
  }

  try {
    await markPdtpExecution({
      activityId: formData.get("activityId"),
      worksiteId: formData.get("worksiteId"),
      year: formData.get("year"),
      month: formData.get("month"),
      week: formData.get("week"),
      executedQuantity: formData.get("executedQuantity"),
      evidenceText: formData.get("evidenceText") ?? "",
    }, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function markPdtpExecutionFormAction(formData: FormData): Promise<ActionState> {
  return markPdtpExecutionAction(formData)
}

// ── WS2: Program lifecycle ──────────────────────────────────────────────────

export async function approvePdtpProgramJdprAction(programId: string): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:approve")) {
    return { ok: false, message: "No tienes permisos para aprobar el programa PDTP." }
  }
  try {
    await approvePdtpProgramJdpr(programId, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function signPdtpProgramLegalAction(programId: string): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:sign_legal")) {
    return { ok: false, message: "No tienes permisos para firmar el programa PDTP." }
  }
  try {
    await signPdtpProgramLegal(programId, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function activatePdtpProgramAction(programId: string): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:approve")) {
    return { ok: false, message: "No tienes permisos para activar el programa PDTP." }
  }
  try {
    await activatePdtpProgram(programId, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

// ── WS3: Execution approval ─────────────────────────────────────────────────

export async function approvePdtpExecutionAction(executionId: string): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:approve")) {
    return { ok: false, message: "No tienes permisos para aprobar ejecuciones PDTP." }
  }
  try {
    const parsed = pdtpExecutionApprovalSchema.parse({ executionId })
    await approvePdtpExecution(parsed.executionId, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

// ── WS4: Activity edit + add ────────────────────────────────────────────────

export async function updatePdtpActivityAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:manage")) {
    return { ok: false, message: "No tienes permisos para editar actividades PDTP." }
  }
  try {
    const parsed = pdtpActivityUpdateSchema.parse(input)
    await updatePdtpActivity(parsed, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function addPdtpActivityAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:pdtp:manage")) {
    return { ok: false, message: "No tienes permisos para agregar actividades PDTP." }
  }
  try {
    const parsed = pdtpActivityAddSchema.parse(input)
    await addPdtpActivity(parsed, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function addPdtpActivityFormAction(fd: FormData): Promise<void> {
  // Página 100% servidor (sin componentes cliente): el feedback de error se
  // propaga por query param en vez de toast, preservando hoja/faena actuales.
  const hoja = String(fd.get("hoja") ?? "")
  const faena = String(fd.get("faena") ?? "")
  const backTo = (errorMessage?: string): never => {
    const params = new URLSearchParams()
    if (hoja) params.set("hoja", hoja)
    if (faena) params.set("faena", faena)
    if (errorMessage) params.set("actividadError", errorMessage)
    const qs = params.toString()
    redirect(qs ? `${REVALIDATE}?${qs}` : REVALIDATE)
  }

  const { session, error } = await guardAuth()
  if (error) return backTo(error.message)
  if (!session.user.permissions?.includes("prevention:pdtp:manage")) {
    return backTo("No tienes permisos para agregar actividades PDTP.")
  }

  try {
    const parsed = pdtpActivityAddSchema.parse({
      programId: fd.get("programId"),
      objectiveOrder: fd.get("objectiveOrder"),
      objective: fd.get("objective"),
      activity: fd.get("activity"),
      program: fd.get("program"),
      responsibleDisplay: fd.get("responsibleDisplay"),
      responsibleSlugs: [fd.get("responsibleSlugs[0]")],
      sheetCodes: [fd.get("sheetCodes[0]")],
      notes: fd.get("notes") ?? undefined,
    })
    await addPdtpActivity(parsed, session.user.id)
  } catch (e) {
    return backTo((e as Error).message)
  }
  revalidatePath(REVALIDATE)
  return backTo()
}
