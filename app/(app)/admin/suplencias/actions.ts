"use server"

import { safeActionMessage } from "@/lib/action-error"

import { revalidatePath } from "next/cache"
import { can, guardPermission } from "@/lib/auth/can"
import { getAppBaseUrl, sendInvitationEmail } from "@/lib/email/smtp"
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
    const created = await createTemporarySubstituteUser(input, guard.session.user.id, can(guard.session, "admin:manage_admins"))
    const inviteUrl = `${getAppBaseUrl()}/registro?token=${encodeURIComponent(created.invitationToken)}`
    let message = `Cuenta temporal de reemplazo creada para ${created.name}. Invitación enviada para definir contraseña.`
    let pendingInviteUrl: string | undefined
    try {
      const delivery = await sendInvitationEmail({
        to: created.email,
        inviteUrl,
        invitedByName: guard.session.user.name,
      })
      if (!delivery.sent) {
        message = `Cuenta temporal creada para ${created.name}. SMTP no está configurado; comparte el enlace de registro antes de su vencimiento.`
        pendingInviteUrl = inviteUrl
      }
    } catch (error) {
      const reason = safeActionMessage(error, "error desconocido")
      message = `Cuenta temporal creada para ${created.name}, pero no se pudo enviar la invitación (${reason}).`
      pendingInviteUrl = inviteUrl
    }
    revalidatePath(ROOT)
    return {
      ok: true,
      message,
      data: pendingInviteUrl ? { email: created.email, inviteUrl: pendingInviteUrl } : undefined,
    }
  } catch (error: unknown) {
    const msg = safeActionMessage(error, "No se pudo crear la cuenta temporal")
    return { ok: false, message: msg }
  }
}

export async function extendTemporarySubstituteAction(args: { userId: string; additionalDays: number }): Promise<ActionState> {
  const guard = await guardPermission("admin:users")
  if (guard.error) return guard.error
  try {
    await extendTemporarySubstituteValidity(args.userId, args.additionalDays, guard.session.user.id, can(guard.session, "admin:manage_admins"))
    revalidatePath(ROOT)
    return { ok: true, message: `Vigencia extendida por ${args.additionalDays} días` }
  } catch (error: unknown) {
    const msg = safeActionMessage(error, "No se pudo extender la vigencia")
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
    const msg = safeActionMessage(error, "No se pudo revocar la cuenta temporal")
    return { ok: false, message: msg }
  }
}
