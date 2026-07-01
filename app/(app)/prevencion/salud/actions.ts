"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { scopeToIds } from "@/lib/ppa/utils"
import {
  registerHealthExam,
  getWorkerHealthExams,
  setHealthAptitude,
  addHealthRestriction,
  isRestricted,
} from "@/lib/services/prevention-health"
import {
  healthExamCreateSchema,
  healthAptitudeSchema,
  healthRestrictionCreateSchema,
  type ActionState,
} from "@/lib/validation/prevention"
import type { HealthExam, HealthRestriction } from "@/db/schema"

const REVALIDATE = "/prevencion/salud"

export async function registerHealthExamAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardPermission("prevention:health:manage")
  if (error) return error

  const parsed = healthExamCreateSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      message: "Revisa los campos del formulario.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  try {
    await registerHealthExam(parsed.data, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Examen registrado." }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al registrar el examen" }
  }
}

export async function setHealthAptitudeAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardPermission("prevention:health:manage")
  if (error) return error

  const parsed = healthAptitudeSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      message: "Revisa los campos del formulario.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  try {
    await setHealthAptitude(parsed.data, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Aptitud registrada." }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al registrar la aptitud" }
  }
}

// Las restricciones de salud son datos sensibles: se exige el permiso
// específico prevention:health:restrict, separado del manage general.
export async function addHealthRestrictionAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardPermission("prevention:health:restrict")
  if (error) return error

  const parsed = healthRestrictionCreateSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      message: "Revisa los campos del formulario.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  try {
    await addHealthRestriction(parsed.data, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Restricción registrada." }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al registrar la restricción" }
  }
}

export async function getWorkerHealthDataAction(
  workerId: string,
): Promise<ActionState & { data?: { exams: HealthExam[]; restrictions: HealthRestriction[] } }> {
  const { session, error } = await guardPermission("prevention:health:view")
  if (error) return error
  if (!workerId) return { ok: false, message: "Falta el trabajador." }

  const scope = scopeToIds(resolveWorksiteScope(session))
  try {
    const [exams, restrictions] = await Promise.all([
      getWorkerHealthExams(workerId, scope),
      isRestricted(workerId, scope),
    ])
    return { ok: true, data: { exams, restrictions } }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al obtener la ficha de salud" }
  }
}
