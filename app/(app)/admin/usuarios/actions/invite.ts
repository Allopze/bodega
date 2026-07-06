"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/db"
import { users, userInvitations } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { generateInvitationToken, hashInvitationToken } from "@/lib/auth/bootstrap"
import { getAppBaseUrl, sendInvitationEmail } from "@/lib/email/smtp"
import { userInvitationSchema, type ActionState } from "@/lib/validation/masters"
import {
  buildWorksiteAssignments,
  validateWorksiteAssignmentScope,
  validateRoleWorksiteRules,
  canManageAdministratorRole,
} from "../actions.helpers"
import { requireAdminPermission } from "./helpers"
import { REVALIDATE } from "./revalidate"

export async function inviteUser(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireAdminPermission()
  if (!session) return { ok: false, message: "Sin permisos para invitar usuarios" }

  const raw = {
    name: formData.get("name") || "",
    email: formData.get("email"),
    roleIds: formData.getAll("roleIds"),
    expiresInDays: formData.get("expiresInDays") || 7,
    worksiteAssignments: buildWorksiteAssignments(formData),
  }

  const parsed = userInvitationSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  const d = parsed.data
  const worksiteScopeError = validateWorksiteAssignmentScope(session, d.worksiteAssignments)
  if (worksiteScopeError) return worksiteScopeError
  const roleError = await validateRoleWorksiteRules(
    d.roleIds,
    d.worksiteAssignments,
    canManageAdministratorRole(session),
  )
  if (roleError) return roleError

  const existing = await db.query.users.findFirst({ where: eq(users.email, d.email) })
  if (existing) {
    return { ok: false, fieldErrors: { email: ["Este correo ya tiene una cuenta"] } }
  }

  const token = generateInvitationToken()
  const inviteUrl = `${getAppBaseUrl()}/registro?token=${encodeURIComponent(token)}`
  const expiresAt = new Date(Date.now() + d.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
  const invitationId = nanoid()

  await db.transaction(async (tx) => {
    await tx.update(userInvitations)
      .set({ acceptedAt: new Date().toISOString() })
      .where(and(
        eq(userInvitations.email, d.email),
        isNull(userInvitations.acceptedAt),
      ))

    await tx.insert(userInvitations).values({
      id: invitationId,
      email: d.email,
      name: d.name || null,
      tokenHash: hashInvitationToken(token),
      roleIdsJson: JSON.stringify(d.roleIds),
      worksiteAssignmentsJson: JSON.stringify(d.worksiteAssignments),
      invitedByUserId: session.user.id,
      expiresAt,
    })
  })

  let deliveryMessage = "Invitación creada"
  let pendingInviteUrl: string | undefined
  try {
    const delivery = await sendInvitationEmail({
      to: d.email,
      inviteUrl,
      invitedByName: session.user.name,
    })
    if (delivery.sent) {
      deliveryMessage = `Invitación enviada a ${d.email}`
    } else {
      deliveryMessage = `Invitación creada. SMTP no está configurado; revisa la invitación pendiente.`
      pendingInviteUrl = inviteUrl
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "error desconocido"
    deliveryMessage = `Invitación creada, pero no se pudo enviar el correo (${reason}).`
    pendingInviteUrl = inviteUrl
  }

  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined,
    action: "create", entityType: "user_invitation", entityId: invitationId,
    newState: { email: d.email, roles: d.roleIds, expiresAt, smtpSent: !pendingInviteUrl },
  })

  if (!pendingInviteUrl) {
    revalidatePath(REVALIDATE)
  }
  return {
    ok: true,
    message: deliveryMessage,
    data: pendingInviteUrl ? { email: d.email, inviteUrl: pendingInviteUrl } : undefined,
  }
}
