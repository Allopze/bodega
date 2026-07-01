"use server"

import { revalidatePath } from "next/cache"
import { guardAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  createEmergencyPlan,
  approveEmergencyPlan,
  scheduleDrill,
  recordDrillExecution,
  registerEmergencyEquipment,
  recordEquipmentInspection,
} from "@/lib/services/prevention-emergency"
import {
  emergencyPlanCreateSchema,
  emergencyDrillScheduleSchema,
  emergencyDrillExecutionSchema,
  emergencyEquipmentCreateSchema,
  equipmentInspectionCreateSchema,
  type ActionState,
} from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/emergencias"

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

function fieldErrorsFrom(error: { flatten: () => { fieldErrors: Record<string, string[] | undefined> } }) {
  return error.flatten().fieldErrors as Record<string, string[]>
}

// Los campos threats/roles/routes/findings son JSON libre (Record<string, unknown>).
// v1: el formulario manda texto plano para estos campos; se intenta parsear como JSON
// y si no es válido se envuelve como { detalle: <texto> } en vez de fallar.
function parseJsonField(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>
  const trimmed = typeof raw === "string" ? raw.trim() : ""
  if (!trimmed) return {}
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    return { detalle: parsed }
  } catch {
    return { detalle: trimmed }
  }
}

interface EmergencyPlanFormInput {
  worksiteId: string
  threats: string
  roles: string
  routes: string
}

export async function createEmergencyPlanAction(
  input: EmergencyPlanFormInput,
): Promise<ActionState & { data?: { id: string } }> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:emergency:manage")) {
    return { ok: false, message: "No tienes permisos para gestionar planes de emergencia." }
  }
  const parsed = emergencyPlanCreateSchema.safeParse({
    worksiteId: input.worksiteId,
    threats: parseJsonField(input.threats),
    roles: parseJsonField(input.roles),
    routes: parseJsonField(input.routes),
  })
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: fieldErrorsFrom(parsed.error) }
  }
  try {
    const row = await createEmergencyPlan(parsed.data, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    if (!row) throw new Error("No se pudo crear el plan de emergencia.")
    revalidatePath(REVALIDATE)
    return { ok: true, data: { id: row.id } }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function approveEmergencyPlanAction(planId: string): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:emergency:approve")) {
    return { ok: false, message: "No tienes permisos para aprobar planes de emergencia." }
  }
  try {
    await approveEmergencyPlan(planId, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Plan aprobado." }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function scheduleDrillAction(input: unknown): Promise<ActionState & { data?: { id: string } }> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:emergency:drill")) {
    return { ok: false, message: "No tienes permisos para programar simulacros." }
  }
  const parsed = emergencyDrillScheduleSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: fieldErrorsFrom(parsed.error) }
  }
  try {
    const row = await scheduleDrill(parsed.data, scopeToIds(resolveWorksiteScope(session)))
    if (!row) throw new Error("No se pudo programar el simulacro.")
    revalidatePath(REVALIDATE)
    return { ok: true, data: { id: row.id } }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

interface DrillExecutionFormInput {
  attendees?: string
  findings: string
  effectiveness?: string
}

export async function recordDrillExecutionAction(
  drillId: string,
  input: DrillExecutionFormInput,
): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:emergency:drill")) {
    return { ok: false, message: "No tienes permisos para registrar simulacros." }
  }
  if (!drillId) return { ok: false, message: "Falta el identificador del simulacro." }
  const parsed = emergencyDrillExecutionSchema.safeParse({
    attendees: input.attendees || undefined,
    findings: parseJsonField(input.findings),
    effectiveness: input.effectiveness,
  })
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: fieldErrorsFrom(parsed.error) }
  }
  try {
    await recordDrillExecution(drillId, parsed.data, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function registerEmergencyEquipmentAction(
  input: unknown,
): Promise<ActionState & { data?: { id: string } }> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:emergency:manage")) {
    return { ok: false, message: "No tienes permisos para registrar equipos de emergencia." }
  }
  const parsed = emergencyEquipmentCreateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: fieldErrorsFrom(parsed.error) }
  }
  try {
    const row = await registerEmergencyEquipment(parsed.data, scopeToIds(resolveWorksiteScope(session)))
    if (!row) throw new Error("No se pudo registrar el equipo.")
    revalidatePath(REVALIDATE)
    return { ok: true, data: { id: row.id } }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

interface EquipmentInspectionFormInput {
  equipmentId: string
  status: string
  findings: string
}

export async function recordEquipmentInspectionAction(input: EquipmentInspectionFormInput): Promise<ActionState> {
  const { session, error } = await guardAuth()
  if (error) return error
  if (!session.user.permissions?.includes("prevention:emergency:manage")) {
    return { ok: false, message: "No tienes permisos para registrar inspecciones de equipos." }
  }
  const parsed = equipmentInspectionCreateSchema.safeParse({
    equipmentId: input.equipmentId,
    status: input.status,
    findings: parseJsonField(input.findings),
  })
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: fieldErrorsFrom(parsed.error) }
  }
  try {
    await recordEquipmentInspection(parsed.data, session.user.id, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}
