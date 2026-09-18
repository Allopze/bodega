"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { ZodError } from "zod"
import { guardPermission } from "@/lib/auth/can"
import { safeActionMessage } from "@/lib/action-error"
import {
  createAnnualPdtpProgram,
  createPdtpRevision,
  decidePdtpRevisionDiff,
  updatePdtpProgram,
  deletePdtpProgram as deletePdtpProgramService,
  createPdtpSheet,
  deletePdtpSheet as deletePdtpSheetService,
} from "@/lib/services/prevention-pdtp"
import type { ActionState } from "@/lib/validation/prevention"
import {
  pdtpProgramCreateSchema,
  pdtpProgramUpdateSchema,
  pdtpProgramDeleteSchema,
  pdtpSheetCreateSchema,
  pdtpSheetDeleteSchema,
} from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/pdtp"

function fail(error: unknown): ActionState {
  if (error instanceof ZodError) {
    return {
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
    }
  }
  // Los servicios PDTP lanzan sus reglas de negocio como `new Error("texto
  // para el operador")` y son la única pista de por qué la operación no
  // avanza. `safeActionMessage` las deja pasar y sigue ocultando los errores
  // de driver y de esquema.
  return { ok: false, message: safeActionMessage(error, "No se pudo completar la acción. Intenta nuevamente.") }
}

// ── Program CRUD ─────────────────────────────────────────────────────────────

export async function createPdtpProgramAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState & { programId?: string }> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  const session = guard.session

  let programId: string
  try {
    const parsed = pdtpProgramCreateSchema.parse({ year: formData.get("year") })
    const result = await createAnnualPdtpProgram({
      year: parsed.year,
      userId: session.user.id,
    })
    programId = result.programId
  } catch (e) {
    return fail(e)
  }
  revalidatePath(REVALIDATE)
  redirect(`${REVALIDATE}/${programId}/editar`)
}

export async function createPdtpRevisionAction(sourceProgramId: string): Promise<ActionState & { programId?: string; programStatus?: string }> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  if (typeof sourceProgramId !== "string" || sourceProgramId.trim().length === 0) {
    return { ok: false, message: "Programa de origen no válido." }
  }
  const sourceId = sourceProgramId.trim()
  try {
    const result = await createPdtpRevision({ sourceProgramId: sourceId, userId: guard.session.user.id })
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${sourceId}`)
    revalidatePath(`${REVALIDATE}/${result.programId}`)
    return { ok: true, programId: result.programId, programStatus: result.program.status }
  } catch (error) {
    return fail(error)
  }
}

export async function decidePdtpRevisionDiffAction(input: {
  programId: string
  activityIdentity: string
  decision: "applied" | "kept"
}): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  if (!input || typeof input !== "object"
    || typeof input.programId !== "string" || input.programId.trim().length === 0
    || typeof input.activityIdentity !== "string" || input.activityIdentity.trim().length === 0
    || (input.decision !== "applied" && input.decision !== "kept")) {
    return { ok: false, message: "La diferencia seleccionada no es válida." }
  }
  const programId = input.programId.trim()
  const activityIdentity = input.activityIdentity.trim()
  try {
    await decidePdtpRevisionDiff({ programId, activityIdentity, decision: input.decision, userId: guard.session.user.id })
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${programId}`)
    revalidatePath(`${REVALIDATE}/${programId}/editar`)
    return { ok: true }
  } catch (error) {
    return fail(error)
  }
}

export async function updatePdtpProgramAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error
  const session = guard.session

  try {
    // La UI envía la meta en porcentaje entero (90) porque es como el usuario
    // la expresa; el modelo la guarda como fracción 0-1 (0.90), que es lo que
    // valida el CHECK de la tabla y compara `compliance.ts`. `Math.round`
    // evita que un 90.5 termine redondeado en silencio por numeric(5,2).
    const percent = formData.get("complianceTargetPercent")
    const parsed = pdtpProgramUpdateSchema.parse({
      programId: formData.get("programId"),
      title: formData.get("title") || undefined,
      complianceTarget: percent
        ? Math.round(Number(percent)) / 100
        : formData.get("complianceTarget") || undefined,
    })
    await updatePdtpProgram(parsed.programId!, parsed, session.user.id)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${parsed.programId}`)
    revalidatePath(`${REVALIDATE}/${parsed.programId}/editar`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function deletePdtpProgramAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error

  try {
    const parsed = pdtpProgramDeleteSchema.parse({ programId: formData.get("programId") })
    await deletePdtpProgramService(parsed.programId)
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

// ── Sheet management ─────────────────────────────────────────────────────────

export async function createPdtpSheetAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error

  try {
    const parsed = pdtpSheetCreateSchema.parse({
      programId: formData.get("programId"),
      code: formData.get("code"),
      label: formData.get("label"),
      area: formData.get("area"),
    })
    await createPdtpSheet(parsed)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${parsed.programId}/editar`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function deletePdtpSheetAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const guard = await guardPermission("prevention:pdtp:program:manage")
  if (guard.error) return guard.error

  try {
    const parsed = pdtpSheetDeleteSchema.parse({
      sheetId: formData.get("sheetId"),
      programId: formData.get("programId"),
    })
    await deletePdtpSheetService(parsed.sheetId, parsed.programId)
    revalidatePath(REVALIDATE)
    revalidatePath(`${REVALIDATE}/${parsed.programId}/editar`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
