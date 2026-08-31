"use server"

import { safeActionMessage } from "@/lib/action-error"

import { revalidatePath } from "next/cache"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { db } from "@/db"
import { roles, userInvitations, users } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { generateInvitationToken, hashInvitationToken } from "@/lib/auth/bootstrap"
import { canAccessWorksite } from "@/lib/auth/can"
import { buildInvitationUrl, isInvitationUsable, parseInvitationJson } from "@/lib/auth/invitations"
import { isPasswordSetupPending } from "@/lib/auth/password-setup"
import { getAppBaseUrl, sendInvitationEmail } from "@/lib/email/smtp"
import type { ActionState } from "@/lib/validation/masters"
import { canManageAdministratorRole } from "../actions.helpers"
import { requireAdminPermission } from "./helpers"
import { REVALIDATE } from "./revalidate"

function validateId(id: FormDataEntryValue | null): string | null {
  const value = String(id ?? "").trim()
  return value.length > 0 ? value : null
}

function validateReason(reason: FormDataEntryValue | null): string | null {
  const value = String(reason ?? "").trim()
  return value.length > 0 ? value : null
}

function computeReplacementExpiresAt(invitation: typeof userInvitations.$inferSelect, now: Date): string {
  const fallbackDurationMs = 7 * 24 * 60 * 60 * 1000
  const createdAtMs = new Date(invitation.createdAt).getTime()
  const expiresAtMs = new Date(invitation.expiresAt).getTime()
  const durationMs = expiresAtMs - createdAtMs

  return new Date(now.getTime() + (Number.isFinite(durationMs) && durationMs > 0
    ? durationMs
    : fallbackDurationMs)).toISOString()
}

async function validateInvitationRoleScope(
  session: NonNullable<Awaited<ReturnType<typeof requireAdminPermission>>>,
  invitation: typeof userInvitations.$inferSelect,
): Promise<ActionState | null> {
  // La invitación lleva su alcance en worksiteAssignmentsJson: un admin acotado
  // no puede tocar invitaciones de faenas que no administra (misma regla que
  // page.tsx al listarlas). Sin asignaciones = invitación global, gestionable.
  const assignments = parseInvitationJson<{ worksiteId: string }[]>(invitation.worksiteAssignmentsJson, [])
  if (assignments.length > 0 && !assignments.some((assignment) => canAccessWorksite(session, assignment.worksiteId))) {
    return { ok: false, message: "Invitación no encontrada" }
  }

  const roleIds = parseInvitationJson<string[]>(invitation.roleIdsJson, [])
  const invitationRoles = roleIds.length
    ? await db.query.roles.findMany({ where: inArray(roles.id, roleIds) })
    : []

  if (!canManageAdministratorRole(session) && invitationRoles.some((role) => role.name === "administrador")) {
    return { ok: false, message: "Solo un administrador puede gestionar invitaciones de administradores" }
  }

  return null
}

export async function cancelInvitation(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireAdminPermission()
  if (!session) return { ok: false, message: "Sin permisos para cancelar invitaciones" }

  const id = validateId(formData.get("id"))
  const reason = validateReason(formData.get("reason"))
  if (!id) return { ok: false, fieldErrors: { id: ["ID requerido"] } }
  if (!reason || reason.length < 3) {
    return { ok: false, fieldErrors: { reason: ["Ingresa un motivo de cancelación"] } }
  }
  if (reason && reason.length > 500) {
    return { ok: false, fieldErrors: { reason: ["El motivo no puede superar 500 caracteres"] } }
  }

  const invitation = await db.query.userInvitations.findFirst({
    where: eq(userInvitations.id, id),
  })
  if (!invitation) return { ok: false, message: "Invitación no encontrada" }
  if (!isInvitationUsable(invitation)) {
    return { ok: false, message: "La invitación ya no está pendiente" }
  }
  const scopeError = await validateInvitationRoleScope(session, invitation)
  if (scopeError) return scopeError

  const now = new Date().toISOString()
  const cancelled = await db.update(userInvitations)
    .set({
      cancelledAt: now,
      cancelledByUserId: session.user.id,
      cancelReason: reason,
    })
    .where(and(
      eq(userInvitations.id, id),
      isNull(userInvitations.acceptedAt),
      isNull(userInvitations.cancelledAt),
      isNull(userInvitations.replacedAt),
    ))
    .returning({ id: userInvitations.id })

  if (cancelled.length === 0) {
    return { ok: false, message: "La invitación ya no está pendiente" }
  }

  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "cancel",
    entityType: "user_invitation",
    entityId: id,
    oldState: { email: invitation.email, expiresAt: invitation.expiresAt },
    newState: { cancelledAt: now, cancelledByUserId: session.user.id, reason },
    reason,
  })

  revalidatePath(REVALIDATE)
  return { ok: true, message: "Invitación cancelada" }
}

export async function resendInvitation(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireAdminPermission()
  if (!session) return { ok: false, message: "Sin permisos para reenviar invitaciones" }

  const id = validateId(formData.get("id"))
  if (!id) return { ok: false, fieldErrors: { id: ["ID requerido"] } }

  const invitation = await db.query.userInvitations.findFirst({
    where: eq(userInvitations.id, id),
  })
  if (!invitation) return { ok: false, message: "Invitación no encontrada" }
  if (invitation.acceptedAt) return { ok: false, message: "La invitación ya fue aceptada" }
  if (!isInvitationUsable(invitation)) {
    return { ok: false, message: "La invitación ya no está pendiente" }
  }
  const scopeError = await validateInvitationRoleScope(session, invitation)
  if (scopeError) return scopeError

  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, invitation.email),
  })
  if (existingUser && !isPasswordSetupPending(existingUser.hashedPassword)) {
    return { ok: false, message: "Este correo ya tiene una cuenta activa" }
  }

  const token = generateInvitationToken()
  const inviteUrl = buildInvitationUrl(getAppBaseUrl(), token)
  const newInvitationId = nanoid()
  const nowDate = new Date()
  const now = nowDate.toISOString()
  const newExpiresAt = computeReplacementExpiresAt(invitation, nowDate)
  const sendCount = (invitation.sendCount ?? 0) + 1

  const replacement = await db.transaction(async (tx) => {
    const replaced = await tx.update(userInvitations)
      .set({ replacedAt: now, replacedByInvitationId: newInvitationId })
      .where(and(
        eq(userInvitations.id, id),
        isNull(userInvitations.acceptedAt),
        isNull(userInvitations.cancelledAt),
        isNull(userInvitations.replacedAt),
      ))
      .returning({ id: userInvitations.id })

    if (replaced.length === 0) return null

    await tx.insert(userInvitations).values({
      id: newInvitationId,
      email: invitation.email,
      name: invitation.name,
      tokenHash: hashInvitationToken(token),
      roleIdsJson: invitation.roleIdsJson,
      worksiteAssignmentsJson: invitation.worksiteAssignmentsJson,
      invitedByUserId: session.user.id,
      expiresAt: newExpiresAt,
      lastSentAt: now,
      sendCount,
    })

    return { id: newInvitationId }
  })

  if (!replacement) {
    return { ok: false, message: "La invitación ya no está pendiente" }
  }

  let message = `Invitación reenviada a ${invitation.email}`
  let pendingInviteUrl: string | undefined
  try {
    const delivery = await sendInvitationEmail({
      to: invitation.email,
      inviteUrl,
      invitedByName: session.user.name,
    })
    if (!delivery.sent) {
      message = "Invitación recreada. SMTP no está configurado; comparte el enlace de registro."
      pendingInviteUrl = inviteUrl
    }
  } catch (error) {
    const reason = safeActionMessage(error, "error desconocido")
    message = `Invitación recreada, pero no se pudo enviar el correo (${reason}).`
    pendingInviteUrl = inviteUrl
  }

  await recordAudit({
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    action: "update",
    entityType: "user_invitation_resend",
    entityId: newInvitationId,
    oldState: { id, email: invitation.email, sendCount: invitation.sendCount ?? 0 },
    newState: { id: newInvitationId, email: invitation.email, sendCount, expiresAt: newExpiresAt, smtpSent: !pendingInviteUrl },
  })

  revalidatePath(REVALIDATE)
  return {
    ok: true,
    message,
    data: pendingInviteUrl ? { email: invitation.email, inviteUrl: pendingInviteUrl } : undefined,
  }
}
