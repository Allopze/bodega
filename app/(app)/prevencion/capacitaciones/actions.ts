"use server"

import { revalidatePath } from "next/cache"
import { guardAuth, guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  createTrainingCourse,
  assignTrainingToWorker,
  listExpiredTrainings,
  listTrainingCourses,
} from "@/lib/services/prevention-training"
import { describeActiveRestrictions } from "@/lib/services/prevention-health"
import {
  trainingCourseCreateSchema,
  trainingAssignSchema,
  type ActionState,
} from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/capacitaciones"

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export async function listTrainingCoursesAction(): Promise<ActionState & { data?: { items: unknown[] } }> {
  const { error } = await guardPermission("prevention:training:view")
  if (error) return error
  try {
    const items = await listTrainingCourses()
    return { ok: true, data: { items } }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function listExpiredTrainingsAction(
  today: string,
): Promise<ActionState & { data?: { items: unknown[] } }> {
  const { session, error } = await guardPermission("prevention:training:view")
  if (error) return error
  try {
    const items = await listExpiredTrainings(scopeToIds(resolveWorksiteScope(session)), today)
    return { ok: true, data: { items } }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function createTrainingCourseAction(
  input: Parameters<typeof createTrainingCourse>[0],
): Promise<ActionState & { data?: { id: string } }> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:training:manage")) {
    return { ok: false, message: "No tienes permisos para crear cursos." }
  }
  const parsed = trainingCourseCreateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    const row = await createTrainingCourse(parsed.data, session.user.id)
    revalidatePath(REVALIDATE)
    return { ok: true, data: { id: row.id } }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function assignTrainingAction(
  input: Parameters<typeof assignTrainingToWorker>[0],
): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:training:manage")) {
    return { ok: false, message: "No tienes permisos para asignar capacitaciones." }
  }
  const parsed = trainingAssignSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    const scope = scopeToIds(resolveWorksiteScope(session))
    await assignTrainingToWorker(parsed.data, session.user.id, scope)
    revalidatePath(REVALIDATE)
    const restrictionWarning = await describeActiveRestrictions(parsed.data.workerId, scope).catch(() => null)
    return { ok: true, message: restrictionWarning ?? undefined }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}