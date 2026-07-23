"use server"

import { revalidatePath } from "next/cache"
import { guardPermission } from "@/lib/auth/can"
import type { ActionState } from "@/lib/validation/masters"
import {
  createTemporarySubstituteUser,
  extendTemporarySubstituteValidity,
  revokeTemporarySubstitute,
} from "@/lib/services/substitutions"

const ROOT = "/admin/suplencias"

export async function createTemporarySubstituteAction(input: unknown): Promise<ActionState> {
  const guard = await guardPermission("admin:users")
  if (guard.error) return guard.error
  try {
    const created = await createTemporarySubstituteUser(input, guard.session.user.id)
    revalidatePath(ROOT)
    return { ok: true, message: `Cuenta temporal de reemplazo creada para ${created.name}` }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "No se pudo crear la cuenta temporal"
    return { ok: false, message: msg }
  }
}

export async function extendTemporarySubstituteAction(args: { userId: string; additionalDays: number }): Promise<ActionState> {
  const guard = await guardPermission("admin:users")
  if (guard.error) return guard.error
  try {
    await extendTemporarySubstituteValidity(args.userId, args.additionalDays, guard.session.user.id)
    revalidatePath(ROOT)
    return { ok: true, message: `Vigencia extendida por ${args.additionalDays} días` }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "No se pudo extender la vigencia"
    return { ok: false, message: msg }
  }
}

export async function revokeTemporarySubstituteAction(userId: string): Promise<ActionState> {
  const guard = await guardPermission("admin:users")
  if (guard.error) return guard.error
  try {
    await revokeTemporarySubstitute(userId, guard.session.user.id)
    revalidatePath(ROOT)
    return { ok: true, message: "Cuenta temporal de reemplazo revocada" }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "No se pudo revocar la cuenta temporal"
    return { ok: false, message: msg }
  }
}
