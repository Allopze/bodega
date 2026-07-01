"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  createCommittee,
  addCommitteeMember,
  scheduleMeeting,
  addAgreement,
} from "@/lib/services/prevention-committees"
import {
  committeeCreateSchema,
  committeeMemberAddSchema,
  committeeMeetingScheduleSchema,
  committeeAgreementAddSchema,
  type ActionState,
} from "@/lib/validation/prevention"

const REVALIDATE = "/prevencion/comites"

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export async function createCommitteeAction(input: unknown): Promise<ActionState> {
  const { session, error } = await guardPermission("prevention:cphs:manage")
  if (error) return error
  const parsed = committeeCreateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    await createCommittee(parsed.data, scopeToIds(resolveWorksiteScope(session)))
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Comité creado." }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al crear el comité" }
  }
}

export async function addCommitteeMemberAction(input: unknown): Promise<ActionState> {
  const { error } = await guardPermission("prevention:cphs:manage")
  if (error) return error
  const parsed = committeeMemberAddSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    await addCommitteeMember(parsed.data)
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Integrante agregado." }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al agregar el integrante" }
  }
}

export async function scheduleMeetingAction(input: unknown): Promise<ActionState> {
  const { error } = await guardPermission("prevention:cphs:manage")
  if (error) return error
  const parsed = committeeMeetingScheduleSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    await scheduleMeeting(parsed.data)
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Reunión agendada." }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al agendar la reunión" }
  }
}

export async function addAgreementAction(input: unknown): Promise<ActionState> {
  const { error } = await guardPermission("prevention:cphs:manage")
  if (error) return error
  const parsed = committeeAgreementAddSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: "Revisa los campos del formulario.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }
  try {
    await addAgreement(parsed.data)
    revalidatePath(REVALIDATE)
    return { ok: true, message: "Acuerdo registrado." }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Error al registrar el acuerdo" }
  }
}
